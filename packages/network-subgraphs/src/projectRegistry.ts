import { BigInt, log, store } from '@graphprotocol/graph-ts'
import { ProjectPaymentDetails, ProjectPermission, ProjectSubscription } from '../generated/schema'
import {
    ProjectCreated,
    ProjectDeleted,
    ProjectUpdated,
    PermissionUpdated,
    Subscribed,
    StreamAdded,
    StreamRemoved,
    PaymentDetailsByChainUpdated,
} from '../generated/ProjectRegistryV1/ProjectRegistryV1'
import { getIsDataUnionValue, loadOrCreateProject } from './helpers'

export function handleProjectCreation(event: ProjectCreated): void {
    const id = event.params.id.toHexString()
    const metadata = event.params.metadata
    log.info('handleProjectCreated: id={} metadata={} blockNumber={}',
        [id, metadata, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.id, BigInt.fromI32(0))

    project.domainIds = event.params.domainIds
    project.minimumSubscriptionSeconds = event.params.minimumSubscriptionSeconds
    project.metadata = metadata
    project.isDataUnion = getIsDataUnionValue(metadata)
    project.streams = event.params.streams
    project.permissions = []
    project.createdAt = event.block.timestamp
    project.counter = 0
    project.score = BigInt.fromI32(0)
    project.save()
}

export function handleProjectDeletion(event: ProjectDeleted): void {
    const id = event.params.id.toHexString()
    log.info('handleProjectDeletion: id={} blockNumber={}', [id, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.id, BigInt.fromI32(0))
    project.permissions.forEach((permissionId) => {
        store.remove('ProjectPermission', permissionId)
    })
    project.subscriptions.forEach((subscriptionId) => {
        store.remove('ProjectSubscription', subscriptionId)
    })
    project.paymentDetails.forEach((paymentId) => {
        store.remove('ProjectPaymentDetails', paymentId)
    })
    project.purchases.forEach((purchaseId) => {
        store.remove('ProjectPurchase', purchaseId)
    })

    store.remove('Project', id)
}

export function handleProjectUpdate(event: ProjectUpdated): void {
    let id = event.params.id.toHexString()
    log.info('handleProjectUpdated: id={} metadata={} blockNumber={}',
        [id, event.params.metadata, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.id, BigInt.fromI32(0))

    project.domainIds = event.params.domainIds
    project.streams = event.params.streams
    project.minimumSubscriptionSeconds = event.params.minimumSubscriptionSeconds
    project.metadata = event.params.metadata
    project.isDataUnion = getIsDataUnionValue(event.params.metadata)
    project.updatedAt = event.block.timestamp
    project.save()
}

export function handlePermissionUpdate(event: PermissionUpdated): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    log.info('handlePermissionUpdate: user={} projectId={} blockNumber={}',
        [user, projectId, event.block.number.toString()])

    let permissionId = projectId + '-' + user
    let permission = new ProjectPermission(permissionId)
    permission.userAddress = event.params.user
    permission.project = projectId
    permission.canBuy = event.params.canBuy
    permission.canDelete = event.params.canDelete
    permission.canEdit = event.params.canEdit
    permission.canGrant = event.params.canGrant
    permission.save()

    let project = loadOrCreateProject(event.params.projectId, BigInt.fromI32(0))
    let i = project.permissions.indexOf(permissionId)
    if (i < 0) {
        let permissionsArray = project.permissions
        permissionsArray.push(permissionId)
        project.permissions = permissionsArray
    }
    project.save()
}

export function handleSubscriptionUpdate(event: Subscribed): void {
    const projectId = event.params.projectId.toHexString()
    const subscriber = event.params.subscriber.toHexString()
    log.info('handleSubscriptionUpdate: projectId={} subscriber={} blockNumber={}',
        [projectId, subscriber, event.block.number.toString()])

    let subscriptionId = projectId + '-' + subscriber
    let subscription = new ProjectSubscription(subscriptionId)
    subscription.project = projectId
    subscription.userAddress = event.params.subscriber
    subscription.endTimestamp = event.params.endTimestamp
    subscription.save()

    let project = loadOrCreateProject(event.params.projectId, BigInt.fromI32(0))
    let i = project.subscriptions.indexOf(subscriptionId)
    if (i < 0) {
        let subscriptionsArray = project.subscriptions
        subscriptionsArray.push(subscriptionId)
        project.subscriptions = subscriptionsArray
    }
    project.save()
}

export function handlePaymentDetailsByChainUpdate(event: PaymentDetailsByChainUpdated): void {
    const projectId = event.params.id.toHexString()
    const domainId = event.params.domainId.toString()
    const beneficiary = event.params.beneficiary.toHexString()
    const pricingTokenAddress = event.params.pricingTokenAddress.toHexString()
    const pricePerSecond = event.params.pricePerSecond.toString()
    log.info('handlePaymentDetailsByChainUpdate: projectId={} domainId={} beneficiary={} pricingTokenAddress={} pricePerSecond={} blockNumber={}',
        [projectId, domainId, beneficiary, pricingTokenAddress, pricePerSecond, event.block.number.toString()])
    
    let paymentDetailsId = projectId + '-' + domainId
    let paymentDetails = new ProjectPaymentDetails(paymentDetailsId)
    paymentDetails.project = projectId
    paymentDetails.domainId = event.params.domainId
    paymentDetails.beneficiary = event.params.beneficiary
    paymentDetails.pricingTokenAddress = event.params.pricingTokenAddress
    paymentDetails.pricePerSecond = event.params.pricePerSecond
    paymentDetails.save()
    
    let project = loadOrCreateProject(event.params.id, BigInt.fromI32(0))
    let i = project.paymentDetails.indexOf(paymentDetailsId)
    if (i < 0) {
        let paymentDetailsArray = project.paymentDetails
        paymentDetailsArray.push(paymentDetailsId)
        project.paymentDetails = paymentDetailsArray
    }
    project.save()
}

export function handleStreamAddition(event: StreamAdded): void {
    let projectId = event.params.projectId.toHexString()
    const streamId = event.params.streamId
    log.info('handleStreamAddition: projectId={} streamId={} blockNumber={}',
        [projectId, streamId, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.projectId, BigInt.fromI32(0))

    const streams = project.streams
    streams.push(streamId)
    project.streams = streams
    project.save()
}

export function handleStreamRemoval(event: StreamRemoved): void {
    let projectId = event.params.projectId.toHexString()
    const streamId = event.params.streamId
    log.info('handleStreamRemoval: projectId={} streamId={} blockNumber={}',
        [projectId, streamId, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.projectId, BigInt.fromI32(0))

    let streams = project.streams
    const streamIndex  = streams.indexOf(streamId)
    if (streamIndex != -1) {
        streams.splice(streamIndex, 1)
    }
    project.streams = streams
    project.save()
}
