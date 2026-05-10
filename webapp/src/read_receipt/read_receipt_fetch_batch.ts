// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchPostReceipts} from './read_receipt_api';

import * as ReceiptStore from './read_receipt_store';

const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function runFetch(): void {
    timer = undefined;
    const ids = [...queued];
    queued.clear();
    if (ids.length === 0) {
        return;
    }
    fetchPostReceipts(ids).
        then((rec) => {
            for (const id of ids) {
                const slice = rec[id];
                if (slice && Object.keys(slice).length > 0) {
                    ReceiptStore.mergeReceipts(id, slice);
                }
            }
        }).
        catch(() => {});
}

/** Debounced GET for receipt maps shown on your own posts. */
export function scheduleReceiptFetch(postId: string): void {
    queued.add(postId);
    if (timer) {
        clearTimeout(timer);
    }
    timer = setTimeout(runFetch, 400);
}
