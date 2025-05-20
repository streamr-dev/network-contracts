import { log } from '@graphprotocol/graph-ts'

import {
    Added,
    Removed
} from '../generated/StreamStorageRegistry/StreamStorageRegistry'
import { Node } from '../generated/schema'

import { getStreamEntityId } from './streamRegistry'

export function handleStorageNodeAddedToStream(event: Added): void {
    const nodeId = event.params.nodeAddress.toHexString()
    const streamEntityId = getStreamEntityId(event.params.streamId)
    log.info('handleStorageNodeAddedToStream: stream={} node={} blockNumber={}', [streamEntityId, nodeId, event.block.number.toString()])

    const node = Node.load(nodeId)!
    if (!node.storedStreams) {
        node.storedStreams = [streamEntityId]
    } else {
        let streams = node.storedStreams
        if (!streams) { streams = [] }
        if (streams.includes(streamEntityId)) { return }
        streams.push(streamEntityId)
        node.storedStreams = streams
    }
    node.save()
}

export function handleStorageNodeRemovedFromStream(event: Removed): void {
    const nodeId = event.params.nodeAddress.toHexString()
    const streamEntityId = getStreamEntityId(event.params.streamId)
    log.info('handleStorageNodeRemovedFromStream: stream={} node={} blockNumber={}', [streamEntityId, nodeId, event.block.number.toString()])

    let node = Node.load(nodeId)!
    if (!node) { return }
    if (!node.storedStreams) { return }
    let streams = node.storedStreams as string[]
    for (let i = 0; i < streams.length; i++) {
        const s = streams[i] as string
        if (s == streamEntityId) {
            streams.splice(i, 1)
            node.storedStreams = streams
            node.save()
            break
        }
    }
}
