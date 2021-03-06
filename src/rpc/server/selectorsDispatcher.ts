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

import { Dispatcher, DispatcherScope } from './dispatcher';
import * as channels from '../channels';
import { Selectors } from '../../selectors';
import { ElementHandleDispatcher } from './elementHandlerDispatcher';
import * as dom from '../../dom';

export class SelectorsDispatcher extends Dispatcher<Selectors, channels.SelectorsInitializer> implements channels.SelectorsChannel {
  constructor(scope: DispatcherScope, selectors: Selectors) {
    super(scope, selectors, 'Selectors', {});
  }

  async register(params: channels.SelectorsRegisterParams): Promise<void> {
    await this._object.register(params.name, params.source, params.contentScript);
  }

  async createSelector(params: channels.SelectorsCreateSelectorParams): Promise<channels.SelectorsCreateSelectorResult> {
    return { value: await this._object._createSelector(params.name, (params.handle as ElementHandleDispatcher)._object as dom.ElementHandle<Element>) };
  }
}
