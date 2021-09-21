import { log, store } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, Permission } from '../generated/schema'

export function handleStreamCreation(event: StreamCreated): void {
    log.info('handleStreamCreation: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = new Stream(event.params.id)
    stream.metadata = event.params.metadata
    stream.save()
}

export function handleStreamDeletion(event: StreamDeleted): void {
    log.info('handleDeleteStream: id={} blockNumber={}',
        [event.params.id, event.block.number.toString()])
    store.remove('Stream', event.params.id)
}

export function handleStreamUpdate(event: StreamUpdated): void {
    log.info('handleUpdateStream: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = Stream.load(event.params.id)!
    stream.metadata = event.params.metadata
    stream.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    log.info('handlePermissionUpdate: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    let permissionId = event.params.streamId + '-' + event.params.user.toHex()
    let permission = new Permission(permissionId)
    permission.userAddress = event.params.user
    permission.stream = event.params.streamId
    permission.edit = event.params.edit
    permission.canDelete = event.params.canDelete
    permission.publishExpiration = event.params.publishExpiration
    permission.subscribeExpiration = event.params.subscribeExpiration
    permission.share = event.params.share
    permission.save()
}
