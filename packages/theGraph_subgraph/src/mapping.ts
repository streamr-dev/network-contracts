import { BigInt, Bytes, log, store } from '@graphprotocol/graph-ts'

import { StreamCreated, StreamDeleted, StreamUpdated, PermissionUpdated }
    from '../generated/StreamRegistry/StreamRegistry'
import { Stream, Permission } from '../generated/schema'

// type i32 = {}

function createPermission(id: string, user: Bytes, stream: string, edit: boolean,
    canDelete: boolean, publish: boolean, subscribed: boolean, share: boolean): Permission {
    const permission = new Permission(id)
    permission.user = user
    permission.stream = stream
    permission.edit = edit
    permission.canDelete = canDelete
    permission.publish = publish
    permission.subscribed = subscribed
    permission.share = share
    return permission
}

export function handleStreamCreation(event: StreamCreated): void {
    // const stream = new Stream(event.params.id.toHex())
    let stream = new Stream(event.params.id)
    stream.metadata = event.params.metadata
    stream.save()
    // const permissionId = event.params.id + '-' + event.params.owner.toHex()
    // const permission = createPermission(permissionId,
    //     event.params.owner, event.params.id.toHex(), true, 1, 1, new BigInt(0))
    // // let permission = new Permission()
    // // permission.expirationTime = new BigInt(0)
    // // permission.isadmin = true
    // // permission.user = event.params.owner
    // // permission.stream = event.params.id.toHex()
    // permission.save()
}
export function handleStreamDeletion(event: StreamDeleted): void {
    log.warning('handleDeleteStream: id={} blockNumber={}',
            [event.params.id, event.block.number.toString()])
    // const stream = Stream.load(event.params.id)
    store.remove("Stream", event.params.id)
}
export function handleStreamUpdate(event: StreamUpdated): void {
    log.warning('handleUpdateStream: id={} metadata={} blockNumber={}',
            [event.params.id, event.params.metadata, event.block.number.toString()])
    let stream = Stream.load(event.params.id)
    stream.metadata = event.params.metadata
    stream.save()
    // store.remove("Stream", event.params.id)
}
export function handlePermissionUpdate(event: PermissionUpdated): void {
}

// export function handleTransferViewRights(event: TransferedViewRights): void {
//     log.warning('handleTransferViewRights: id={} to={} blockNumber={}',
//         [event.params.streamid.toHexString(), event.params.to.toHex(), event.block.number.toString()])

//     const permissionSenderId = event.params.streamid.toHex() + '-' + event.params.from.toHex()
//     const permissionRecipientId = event.params.streamid.toHex() + '-' + event.params.to.toHex()
//     const permissionSender = Permission.load(permissionSenderId)
//     let permissionRecipient = Permission.load(permissionRecipientId)
//     if (permissionRecipient == null) {
//         permissionRecipient = createPermission(permissionRecipientId, event.params.to,
//             event.params.streamid.toHex(), false, 0, 0, new BigInt(0))
//     }
//     permissionSender.viewRights -= event.params.amount
//     permissionRecipient.viewRights += event.params.amount
//     permissionSender.save()
//     permissionRecipient.save()
// }

// export function handleTransferPublishRights(event: TransferedPublishRights): void {
//     log.warning('handleTransferPublishRights: id={} to={} blockNumber={}',
//         [event.params.streamid.toHexString(), event.params.to.toHex(), event.block.number.toString()])

//     const permissionSenderId = event.params.streamid.toHex() + '-' + event.params.from.toHex()
//     const permissionRecipientId = event.params.streamid.toHex() + '-' + event.params.to.toHex()
//     const permissionSender = Permission.load(permissionSenderId)
//     let permissionRecipient = Permission.load(permissionRecipientId)
//     if (permissionRecipient == null) {
//         permissionRecipient = createPermission(permissionRecipientId, event.params.to,
//             event.params.streamid.toHex(), false, 0, 0, new BigInt(0))
//     }
//     permissionSender.publishRights -= event.params.amount
//     permissionRecipient.publishRights += event.params.amount
//     permissionSender.save()
//     permissionRecipient.save()
// }
