// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {markPostsRead} from './read_receipt_api';

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
    timer = undefined;
    const ids = [...pending];
    pending.clear();
    if (ids.length === 0) {
        return;
    }
    markPostsRead(ids).catch(() => {});
}

/** Debounced POST so scrolling does not send one request per post. */
export function enqueueMarkPostRead(postId: string): void {
    pending.add(postId);
    if (timer) {
        clearTimeout(timer);
    }
    timer = setTimeout(flush, 650);
}
