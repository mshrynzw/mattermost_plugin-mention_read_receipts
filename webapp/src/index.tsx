// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';
import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import type {PluginRegistry} from 'types/mattermost-webapp';

import PostReadReceipt from './read_receipt/read_receipt_post';
import * as ReceiptStore from './read_receipt/read_receipt_store';

export default class Plugin {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async initialize(registry: PluginRegistry, _store: Store<GlobalState>) {
        registry.registerPostMessageAttachmentComponent(PostReadReceipt);

        const wsEvent = `custom_${manifest.id}_read_receipt_updated`;
        registry.registerWebSocketEventHandler(wsEvent, (msg) => {
            const raw = msg.data;
            if (!raw || typeof raw !== 'object') {
                return;
            }
            const d = raw as Record<string, unknown>;
            const postId = typeof d.post_id === 'string' ? d.post_id : String(d.post_id ?? '');
            const readerId = typeof d.reader_id === 'string' ? d.reader_id : String(d.reader_id ?? '');
            if (!postId || !readerId || d.read_at === undefined || d.read_at === null) {
                return;
            }
            let readAt: number;
            if (typeof d.read_at === 'number') {
                readAt = d.read_at;
            } else {
                readAt = Number.parseInt(String(d.read_at), 10);
            }
            if (!Number.isFinite(readAt)) {
                return;
            }
            ReceiptStore.applyReceiptEvent(postId, readerId, readAt);
        });
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
