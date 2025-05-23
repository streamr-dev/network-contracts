import { log } from '@graphprotocol/graph-ts'

import {
    Added,
    Removed
} from '../generated/StreamStorageRegistry/StreamStorageRegistry'
import { Node } from '../generated/schema'
import { MAX_STREAM_ID_LENGTH } from './helpers'

export function handleStorageNodeAddedToStream(event: Added): void {
    let nodeId = event.params.nodeAddress.toHexString()
    let streamId = event.params.streamId.toString()
    log.info('handleStorageNodeAddedToStream: stream={} node={} blockNumber={}', [streamId, nodeId, event.block.number.toString()])
    if (event.params.streamId.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.streamId]) 
        return
    }

    let node = Node.load(nodeId)!
    if (!node.storedStreams) {
        node.storedStreams = [streamId]
    } else {
        let streams = node.storedStreams
        if (!streams) { streams = [] }
        if (streams.includes(streamId)) { return }
        streams.push(streamId)
        node.storedStreams = streams
    }
    node.save()
}

export function handleStorageNodeRemovedFromStream(event: Removed): void {
    let nodeId = event.params.nodeAddress.toHexString()
    let streamId = event.params.streamId.toString()
    log.info('handleStorageNodeRemovedFromStream: stream={} node={} blockNumber={}', [streamId, nodeId, event.block.number.toString()])
    if (event.params.streamId.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.streamId]) 
        return
    }
    
    let node = Node.load(nodeId)!
    if (!node) { return }
    if (!node.storedStreams) { return }
    let streams = node.storedStreams as string[]
    for (let i = 0; i < streams.length; i++) {
        let s = streams[i] as string
        if (s == streamId) {
            streams.splice(i, 1)
            node.storedStreams = streams
            node.save()
            break
        }
    }
}
