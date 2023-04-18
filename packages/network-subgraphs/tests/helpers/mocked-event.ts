/* eslint-disable max-len */
import { Address, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as"
import { ProjectPaymentDetails } from "../../generated/schema"
import { ProjectPurchased } from "../../generated/MarketplaceV4/MarketplaceV4"
import {
    PaymentDetailsByChainUpdated,
    PermissionUpdated,
    ProjectCreated,
    ProjectDeleted,
    ProjectUpdated,
    StreamAdded,
    StreamRemoved,
    Subscribed,
} from "../../generated/ProjectRegistryV1/ProjectRegistryV1"
import { 
    Stake,
    Unstake,
} from "../../generated/ProjectStakingV1/ProjectStakingV1"
import { getIsDataUnionValue } from "../../src/helpers"

//////////////////////// ProjectRegistry ////////////////////////

export function createProjectCreatedEvent(
    id: Bytes,
    domainIds: number[],
    paymentDetails: ProjectPaymentDetails[], // TODO: use this to construct paymentDetailsParam
    streams: string[],
    minimumSubscriptionSeconds: number,
    metadata: string
): ProjectCreated {
    log.info('mock createProjectCreatedEvent => paymentDetailsLength length={}, streamsLength length={}', [paymentDetails.length.toString(), streams.length.toString()])
    const projectCreatedEvent = changetype<ProjectCreated>(newMockEvent())
    projectCreatedEvent.parameters = []

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectCreatedEvent.parameters.push(idParam)
    const domainIdsParsed = new Array<i32>()
    for (let i = 0; i < domainIds.length; i++) {
        domainIdsParsed.push(domainIds[i] as i32)
    }
    const domainIdsParam = new ethereum.EventParam("domainIds", ethereum.Value.fromI32Array(domainIdsParsed))
    projectCreatedEvent.parameters.push(domainIdsParam)
    const paymentDetailsParam = new ethereum.EventParam("paymentDetails", ethereum.Value.fromArray([])) // TODO: retrieve paymentDetails from function param
    projectCreatedEvent.parameters.push(paymentDetailsParam)
    const streamsParam = new ethereum.EventParam("streams", ethereum.Value.fromStringArray(streams))
    projectCreatedEvent.parameters.push(streamsParam)
    const minSubSecondsParam = new ethereum.EventParam("minimumSubscriptionSeconds", ethereum.Value.fromI32(minimumSubscriptionSeconds as i32))
    projectCreatedEvent.parameters.push(minSubSecondsParam)
    const metadataParam = new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata))
    projectCreatedEvent.parameters.push(metadataParam)
    const isDataUnionParam = new ethereum.EventParam("isDataUnion", ethereum.Value.fromBoolean(getIsDataUnionValue(metadata)))
    projectCreatedEvent.parameters.push(isDataUnionParam)
    
    return projectCreatedEvent
}

export function createProjectUpdatedEvent(
    id: Bytes,
    domainIds: number[],
    paymentDetails: ProjectPaymentDetails[], // TODO: use this to construct paymentDetailsParam
    streams: string[],
    minimumSubscriptionSeconds: number,
    metadata: string
): ProjectUpdated {
    log.info('mock createProjectUpdatedEvent => paymentDetails length length={}', [paymentDetails.length.toString()])
    const projectUpdatedEvent = changetype<ProjectUpdated>(newMockEvent())
    projectUpdatedEvent.parameters = []

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectUpdatedEvent.parameters.push(idParam)
    const domainIdsParsed = new Array<i32>()
    for (let i = 0; i < domainIds.length; i++) {
        domainIdsParsed.push(domainIds[i] as i32)
    }
    const domainIdsParam = new ethereum.EventParam("domainIds", ethereum.Value.fromI32Array(domainIdsParsed))
    projectUpdatedEvent.parameters.push(domainIdsParam)
    const paymentDetailsParam = new ethereum.EventParam("paymentDetails", ethereum.Value.fromArray([])) // TODO: retrieve paymentDetails from function param
    projectUpdatedEvent.parameters.push(paymentDetailsParam)

    const streamsParam = new ethereum.EventParam("streams", ethereum.Value.fromStringArray(streams))
    projectUpdatedEvent.parameters.push(streamsParam)

    const minSubSecondsParam = new ethereum.EventParam("minimumSubscriptionSeconds", ethereum.Value.fromI32(minimumSubscriptionSeconds as i32))
    projectUpdatedEvent.parameters.push(minSubSecondsParam)
    const metadataParam = new ethereum.EventParam("metadata", ethereum.Value.fromString(metadata))
    projectUpdatedEvent.parameters.push(metadataParam)
    const isDataUnionParam = new ethereum.EventParam("isDataUnion", ethereum.Value.fromBoolean(getIsDataUnionValue(metadata)))
    projectUpdatedEvent.parameters.push(isDataUnionParam)
    
    return projectUpdatedEvent
}

export function createStreamAddedEvent(projectId: Bytes, streamId: string): StreamAdded {
    const streamAddedEvent = changetype<StreamAdded>(newMockEvent())
    streamAddedEvent.parameters = []
    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    streamAddedEvent.parameters.push(projectIdParam)
    const streamIdParam = new ethereum.EventParam("streamId", ethereum.Value.fromString(streamId))
    streamAddedEvent.parameters.push(streamIdParam)
    return streamAddedEvent
}

export function createStreamedRemovedEvent(projectId: Bytes, streamId: string): StreamRemoved {
    const streamRemovedEvent = changetype<StreamRemoved>(newMockEvent())
    streamRemovedEvent.parameters = []
    const projectIdPAram = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    streamRemovedEvent.parameters.push(projectIdPAram)
    const streamIdParam = new ethereum.EventParam("streamId", ethereum.Value.fromString(streamId))
    streamRemovedEvent.parameters.push(streamIdParam)
    return streamRemovedEvent
}

export function createPermissionUpdatedEvent(
    user: string,
    projectId: Bytes,
    canBuy: boolean,
    canDelete: boolean,
    canEdit: boolean,
    canGrant: boolean
): PermissionUpdated {
    const permissionUpdatedEvent = changetype<PermissionUpdated>(newMockEvent())
    permissionUpdatedEvent.parameters = []

    const projectParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    permissionUpdatedEvent.parameters.push(projectParam)
    const userParam = new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.fromString(user)))
    permissionUpdatedEvent.parameters.push(userParam)
    const canBuyParam = new ethereum.EventParam("canBuy", ethereum.Value.fromBoolean(canBuy))
    permissionUpdatedEvent.parameters.push(canBuyParam)
    const canDeleteParam = new ethereum.EventParam("canDelete", ethereum.Value.fromBoolean(canDelete))
    permissionUpdatedEvent.parameters.push(canDeleteParam)
    const canEditParam = new ethereum.EventParam("canEdit", ethereum.Value.fromBoolean(canEdit))
    permissionUpdatedEvent.parameters.push(canEditParam)
    const canGrantParam = new ethereum.EventParam("canGrant", ethereum.Value.fromBoolean(canGrant))
    permissionUpdatedEvent.parameters.push(canGrantParam)
    
    return permissionUpdatedEvent
}

export function createSubscribedEvent(projectId: Bytes, subscriber: string, endTimestamp: number): Subscribed {
    const subscribedEvent = changetype<Subscribed>(newMockEvent())
    subscribedEvent.parameters = []

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    subscribedEvent.parameters.push(projectIdParam)
    const subscriberParam = new ethereum.EventParam("subscriber", ethereum.Value.fromAddress(Address.fromString(subscriber)))
    subscribedEvent.parameters.push(subscriberParam)
    const endTimestampParam = new ethereum.EventParam("endTimestamp", ethereum.Value.fromI32(endTimestamp as i32))
    subscribedEvent.parameters.push(endTimestampParam)

    return subscribedEvent
}

export function createPaymentDetailsByChainUpdatedEvent(projectId: Bytes, domainId: number, beneficiary: string, pricingTokenAddress: string, pricePerSecond: number): PaymentDetailsByChainUpdated {
    const paymentEvent = changetype<PaymentDetailsByChainUpdated>(newMockEvent())
    paymentEvent.parameters = []

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    paymentEvent.parameters.push(projectIdParam)
    const domainIdParam = new ethereum.EventParam("domainId", ethereum.Value.fromI32(domainId as i32))
    paymentEvent.parameters.push(domainIdParam)
    const beneficiaryParam = new ethereum.EventParam("beneficiary", ethereum.Value.fromAddress(Address.fromString(beneficiary)))
    paymentEvent.parameters.push(beneficiaryParam)
    const pricingTokenAddressParam = new ethereum.EventParam("pricingTokenAddress", ethereum.Value.fromAddress(Address.fromString(pricingTokenAddress)))
    paymentEvent.parameters.push(pricingTokenAddressParam)
    const pricePerSecondParam = new ethereum.EventParam("pricePerSecond", ethereum.Value.fromI32(pricePerSecond as i32))
    paymentEvent.parameters.push(pricePerSecondParam)

    return paymentEvent
}

export function createProjectDeletedEvent(
    id: Bytes,
): ProjectDeleted {
    const projectDeletedEvent = changetype<ProjectDeleted>(newMockEvent())
    projectDeletedEvent.parameters = []

    const idParam = new ethereum.EventParam("id", ethereum.Value.fromBytes(id))
    projectDeletedEvent.parameters.push(idParam)
    
    return projectDeletedEvent
}

//////////////////////// MarketplaceV4 ////////////////////////

export function createProjectPurchasedEvent(
    projectId: Bytes,
    subscriber: string,
    subscriptionSeconds: number,
    price: number, fee: number,
): ProjectPurchased {
    const projectPurchasedEvent = changetype<ProjectPurchased>(newMockEvent())
    projectPurchasedEvent.parameters = []

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    projectPurchasedEvent.parameters.push(projectIdParam)
    const subscriberParam = new ethereum.EventParam("subscriber", ethereum.Value.fromAddress(Address.fromString(subscriber)))
    projectPurchasedEvent.parameters.push(subscriberParam)
    const subscriptionSecondsParam = new ethereum.EventParam("subscriptionSeconds", ethereum.Value.fromI32(subscriptionSeconds as i32))
    projectPurchasedEvent.parameters.push(subscriptionSecondsParam)
    const priceParam = new ethereum.EventParam("price", ethereum.Value.fromI32(price as i32))
    projectPurchasedEvent.parameters.push(priceParam)
    const feeParam = new ethereum.EventParam("fee", ethereum.Value.fromI32(fee as i32))
    projectPurchasedEvent.parameters.push(feeParam)

    return projectPurchasedEvent
}

//////////////////////// ProjectStakingV1 ////////////////////////

export function createStakeEvent(projectId: Bytes, user: string, amount: number, totalStake: number): Stake {
    const stakeEvent = changetype<Stake>(newMockEvent())
    stakeEvent.parameters = []

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    stakeEvent.parameters.push(projectIdParam)
    const userParam = new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.fromString(user)))
    stakeEvent.parameters.push(userParam)
    const amountParam = new ethereum.EventParam("amount", ethereum.Value.fromI32(amount as i32))
    stakeEvent.parameters.push(amountParam)
    const totalStakeParam = new ethereum.EventParam("totalStake", ethereum.Value.fromI32(totalStake as i32))
    stakeEvent.parameters.push(totalStakeParam)

    return stakeEvent
}

export function createUnstakeEvent(projectId: Bytes, user: string, amount: number, totalStake: number): Unstake {
    const unstakeEvent = changetype<Unstake>(newMockEvent())
    unstakeEvent.parameters = []

    const projectIdParam = new ethereum.EventParam("projectId", ethereum.Value.fromBytes(projectId))
    unstakeEvent.parameters.push(projectIdParam)
    const userParam = new ethereum.EventParam("user", ethereum.Value.fromAddress(Address.fromString(user)))
    unstakeEvent.parameters.push(userParam)
    const amountParam = new ethereum.EventParam("amount", ethereum.Value.fromI32(amount as i32))
    unstakeEvent.parameters.push(amountParam)
    const totalStakeParam = new ethereum.EventParam("totalStake", ethereum.Value.fromI32(totalStake as i32))
    unstakeEvent.parameters.push(totalStakeParam)

    return unstakeEvent
}
