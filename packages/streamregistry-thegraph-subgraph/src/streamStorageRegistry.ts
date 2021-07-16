import { log, store } from '@graphprotocol/graph-ts'

import {
    Added,
    Removed
} from '../generated/StreamStorageRegistry/StreamStorageRegistry'

import { Node } from '../generated/schema'

export function handleStorageNodeAddedToStream(event: Added): void {
    let nodeId = event.params.nodeAddress.toString()
    let streamId = event.params.streamId.toString()
    log.info('handleStorageNodeAddedToStream: stream={} node={} blockNumber={}', [streamId, nodeId, event.block.number.toString()])

    // let stream = Stream.load(streamId)
    // if (!stream.storageNodes) {
    //     stream.storageNodes = []
    // }
    // stream.storageNodes.push(nodeId)
    // stream.save()

    let node = Node.load(nodeId)
    if (!node.storedStreams) {
        node.storedStreams = []
    }
    node.storedStreams.push(streamId)
    node.save()
}

export function handleStorageNodeRemovedFromStream(event: Removed): void {
    let nodeId = event.params.nodeAddress.toString()
    let streamId = event.params.streamId.toString()
    log.info('handleStorageNodeRemovedFromStream: stream={} node={} blockNumber={}', [streamId, nodeId, event.block.number.toString()])

    let node = Node.load(nodeId)
    if (!node) { return }
    if (node.storedStreams) {
        node.storedStreams = node.storedStreams.filter(streamId => streamId !== streamId)
        node.save()
    }
}
