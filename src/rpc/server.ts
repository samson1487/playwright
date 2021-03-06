/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Transport } from './transport';
import { DispatcherConnection } from './server/dispatcher';
import { Playwright } from '../server/playwright';
import { PlaywrightDispatcher } from './server/playwrightDispatcher';
import { Electron } from '../server/electron';
import { gracefullyCloseAll } from '../server/processLauncher';

const dispatcherConnection = new DispatcherConnection();
const transport = new Transport(process.stdout, process.stdin);
transport.onclose = async () => {
  // Force exit after 30 seconds.
  setTimeout(() => process.exit(0), 30000);
  // Meanwhile, try to gracefully close all browsers.
  await gracefullyCloseAll();
  process.exit(0);
};
transport.onmessage = message => dispatcherConnection.dispatch(JSON.parse(message));
dispatcherConnection.onmessage = message => transport.send(JSON.stringify(message));

const playwright = new Playwright(__dirname, require('../../browsers.json')['browsers']);
(playwright as any).electron = new Electron();
new PlaywrightDispatcher(dispatcherConnection.rootDispatcher(), playwright);
