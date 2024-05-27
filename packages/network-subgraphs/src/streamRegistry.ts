import { log, store } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated, PermissionUpdatedForUserId }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, StreamPermission } from '../generated/schema'

export function handleStreamCreation(event: StreamCreated): void {
    log.info('handleStreamCreation: id={} metadata={} blockNumber={}',
        [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = new Stream(event.params.id)
    stream.metadata = event.params.metadata
    stream.createdAt = event.block.timestamp
    stream.updatedAt = event.block.timestamp
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
    let stream = Stream.load(event.params.id)
    if (stream === null) {
        stream = new Stream(event.params.id)
        stream.createdAt = event.block.timestamp
    }
    stream.metadata = event.params.metadata
    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    log.info('handlePermissionUpdate: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    let stream = Stream.load(event.params.streamId)
    if (stream == null) { return }

    let permissionId = event.params.streamId + '-' + event.params.user.toHex()
    let permission = new StreamPermission(permissionId)
    permission.userAddress = event.params.user
    permission.userId = event.params.user
    permission.stream = event.params.streamId
    permission.canEdit = event.params.canEdit
    permission.canDelete = event.params.canDelete
    permission.publishExpiration = event.params.publishExpiration
    permission.subscribeExpiration = event.params.subscribeExpiration
    permission.canGrant = event.params.canGrant
    permission.save()

    stream.updatedAt = event.block.timestamp
    stream.save()
}

export function handlePermissionUpdateForUserId(event: PermissionUpdatedForUserId): void {
    log.info('handlePermissionUpdate: user={} streamId={} blockNumber={}',
        [event.params.user.toHexString(), event.params.streamId, event.block.number.toString()])
    let stream = Stream.load(event.params.streamId)
    if (stream == null) { return }

    let permissionId = event.params.streamId + '-' + event.params.user.toHex()
    let permission = new StreamPermission(permissionId)
    permission.userId = event.params.user
    permission.stream = event.params.streamId
    permission.canEdit = event.params.canEdit
    permission.canDelete = event.params.canDelete
    permission.publishExpiration = event.params.publishExpiration
    permission.subscribeExpiration = event.params.subscribeExpiration
    permission.canGrant = event.params.canGrant
    permission.save()

    stream.updatedAt = event.block.timestamp
    stream.save()
}
