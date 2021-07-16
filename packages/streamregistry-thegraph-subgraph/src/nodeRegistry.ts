import { log, store } from '@graphprotocol/graph-ts'

import {
    NodeUpdated,
    NodeRemoved,
    // NodeWhitelistApproved,
    // NodeWhitelistRejected
} from '../generated/NodeRegistry/NodeRegistry'

import { Node } from '../generated/schema'

export function handleNodeUpdate(event: NodeUpdated): void {
    let id = event.params.nodeAddress.toHexString()
    let isNew = !event.params.isNew.isZero()
    log.info('handleStreamCreation: {} node={} metadata={} blockNumber={}',
        [isNew ? 'NEW' : 'UPDATE', id, event.params.metadata.toString(), event.block.number.toString()])

    let node = Node.load(id) || new Node(id)

    node.metadata = event.params.metadata.toString()
    node.lastSeen = event.params.lastSeen
    node.save()
}

export function handleNodeRemoved(event: NodeRemoved): void {
    let id = event.params.nodeAddress.toHexString()
    log.info('handleNodeRemoved: node={} blockNumber={}', [id, event.block.number.toString()])
    store.remove('Node', id)
}

// export function handleNodeWhitelistApproved(event: NodeWhitelistApproved): void {
//     const id = event.params.nodeAddress.toString()
//     log.info('handleNodeWhitelistApproved: node={} blockNumber={}', [id, event.block.number.toString()])
//     let node = Node.load(id)
//     node.whitelisted = true
//     node.save()
// }

// export function handleNodeWhitelistRejected(event: NodeWhitelistRejected): void {
//     const id = event.params.nodeAddress.toString()
//     log.info('handleNodeWhitelistRejected: node={} blockNumber={}', [id, event.block.number.toString()])
//     let node = Node.load(id)
//     node.whitelisted = false
//     node.save()
// }
