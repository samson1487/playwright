/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import Mocha from 'mocha';
import { FixturePool, registerWorkerFixture, rerunRegistrations, setParameters } from './fixtures';
import { fixturesUI } from './fixturesUI';
import { EventEmitter } from 'events';

export const fixturePool = new FixturePool();
declare global {
  namespace NodeJS {
    interface Global { 
      expect: typeof import('expect')
    }
  }
}
global.expect = require('expect');
const GoldenUtils = require('./GoldenUtils');

export type TestRunnerEntry = {
  file: string;
  ordinals: number[];
  configuredFile: string;
  configurationObject: any;
};

class NullReporter {}

export class TestRunner extends EventEmitter {
  mocha: any;
  private _currentOrdinal = -1;
  private _failedWithError = false;
  private _file: any;
  private _ordinals: Set<number>;
  private _remaining: Set<number>;
  private _trialRun: any;
  private _passes = 0;
  private _failures = 0;
  private _pending = 0;
  private _configuredFile: any;
  private _configurationObject: any;
  private _parsedGeneratorConfiguration: any = {};
  private _relativeTestFile: string;
  private _runner: Mocha.Runner;
  private _outDir: string;
  private _timeout: number;
  private _testDir: string;

  constructor(entry: TestRunnerEntry, options, workerId) {
    super();
    this.mocha = new Mocha({
      reporter: NullReporter,
      timeout: 0,
      ui: fixturesUI.bind(null, {
        testWrapper: (fn, title, file, isSlow) => this._testWrapper(fn, title, file, isSlow),
        hookWrapper: (hook, fn) => this._hookWrapper(hook, fn),
        ignoreOnly: true
      }),
    });
    this._file = entry.file;
    this._ordinals = new Set(entry.ordinals);
    this._remaining = new Set(entry.ordinals);
    this._trialRun = options.trialRun;
    this._timeout = options.timeout;
    this._testDir = options.testDir;
    this._outDir = options.outputDir;
    this._configuredFile = entry.configuredFile;
    this._configurationObject = entry.configurationObject;
    for (const {name, value} of this._configurationObject) {
      this._parsedGeneratorConfiguration[name] = value;
      // @ts-ignore
      registerWorkerFixture(name, async ({}, test) => await test(value));
    }
    this._parsedGeneratorConfiguration['parallelIndex'] = workerId;
    this._relativeTestFile = path.relative(options.testDir, this._file);
    this.mocha.addFile(this._file);
  }

  async stop() {
    this._trialRun = true;
    const constants = Mocha.Runner.constants;
    return new Promise(f => this._runner.once(constants.EVENT_RUN_END, f));
  }

  async run() {
    let callback;
    const result = new Promise(f => callback = f);
    setParameters(this._parsedGeneratorConfiguration);
    this.mocha.loadFiles();
    rerunRegistrations(this._file, 'test');
    this._runner = this.mocha.run(callback);

    const constants = Mocha.Runner.constants;
    this._runner.on(constants.EVENT_TEST_BEGIN, test => {
      relativeTestFile = this._relativeTestFile;
      if (this._failedWithError)
        return;
      const ordinal = ++this._currentOrdinal;
      if (this._ordinals.size && !this._ordinals.has(ordinal))
        return;
      this._remaining.delete(ordinal);
      this.emit('test', { test: this._serializeTest(test, ordinal) });
    });

    this._runner.on(constants.EVENT_TEST_PENDING, test => {
      if (this._failedWithError)
        return;
      const ordinal = ++this._currentOrdinal;
      if (this._ordinals.size && !this._ordinals.has(ordinal))
        return;
      this._remaining.delete(ordinal);
      ++this._pending;
      this.emit('pending', { test: this._serializeTest(test, ordinal) });
    });

    this._runner.on(constants.EVENT_TEST_PASS, test => {
      if (this._failedWithError)
        return;

      const ordinal = this._currentOrdinal;
      if (this._ordinals.size && !this._ordinals.has(ordinal))
        return;
      ++this._passes;
      this.emit('pass', { test: this._serializeTest(test, ordinal) });
    });

    this._runner.on(constants.EVENT_TEST_FAIL, (test, error) => {
      if (this._failedWithError)
        return;
      ++this._failures;
      this._failedWithError = error;
      this.emit('fail', {
        test: this._serializeTest(test, this._currentOrdinal),
        error: serializeError(error),
      });
    });

    this._runner.once(constants.EVENT_RUN_END, async () => {
      this.emit('done', {
        stats: this._serializeStats(this._runner.stats),
        error: this._failedWithError,
        remaining: [...this._remaining],
        total: this._runner.stats.tests
      });
    });
    await result;
  }

  _shouldRunTest(hook = false) {
    if (this._trialRun || this._failedWithError)
      return false;
    if (hook) {
      // Hook starts before we bump the test ordinal.
      if (!this._ordinals.has(this._currentOrdinal + 1))
        return false;
    } else {
      if (!this._ordinals.has(this._currentOrdinal))
        return false;
    }
    return true;
  }

  _testWrapper(fn, title, file, isSlow) {
    const timeout = isSlow ? this._timeout * 3 : this._timeout;
    const wrapped = fixturePool.wrapTestCallback(fn, timeout, {
      outputDir: this._outDir,
      testDir: this._testDir,
      title,
      file,
      timeout
    });
    return wrapped ? (done, ...args) => {
      if (!this._shouldRunTest()) {
        done();
        return;
      }
      wrapped(...args).then(done).catch(done);
    } : undefined;
  }

  _hookWrapper(hook, fn) {
    if (!this._shouldRunTest(true))
      return;
    return hook(async () => {
      return await fixturePool.resolveParametersAndRun(fn, 0);
    });
  }

  _serializeTest(test, ordinal) {
    return {
      id: `${ordinal}@${this._configuredFile}`,
      duration: test.duration,
    };
  }
  
  _serializeStats(stats) {
    return {
      passes: this._passes,
      failures: this._failures,
      pending: this._pending,
      duration: stats.duration || 0,
    }
  }  
}

function trimCycles(obj) {
  const cache = new Set();
  return JSON.parse(
    JSON.stringify(obj, function(key, value) {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value))
          return '' + value;
        cache.add(value);
      }
      return value;
    })
  );
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    }
  }
  return trimCycles(error);
}

let relativeTestFile;

export function initializeImageMatcher(options) {
  function toMatchImage(received, name, config) {
    const { pass, message } = GoldenUtils.compare(received, name, { ...options, relativeTestFile, config });
    return { pass, message: () => message };
  };
  global.expect.extend({ toMatchImage });
}
