import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
    ProjectPaymentDetails,
    ProjectPermission,
    Project,
    ProjectPurchase,
    ProjectStake,
    ProjectSubscription,
} from "../../generated/schema"

export function createProjectEntity(projectId: string): Project {
    const project = new Project(projectId)
    project.id = projectId
    project.domainIds = [BigInt.fromI32(1234)]
    project.paymentDetails = []
    project.minimumSubscriptionSeconds = BigInt.fromI32(1)
    project.metadata = "metadata-" + projectId
    project.isDataUnion = false
    project.subscriptions = []
    project.streams = []
    project.permissions = []
    project.purchases = []
    project.counter = 0
    project.score = BigInt.fromI32(0)
    project.totalStake = BigInt.fromI32(0)
    project.save()
    return project
}

export function createPermissionEntity(
    projectId: string,
    permissionId: string,
    userAddress: string,
    canBuy: boolean, canDelete: boolean, canEdit: boolean, canGrant: boolean
): ProjectPermission {
    const permission = new ProjectPermission(permissionId)
    permission.id = permissionId
    permission.userAddress = Bytes.fromHexString(userAddress)
    permission.project = projectId
    permission.canBuy = canBuy
    permission.canDelete = canDelete
    permission.canEdit = canEdit
    permission.canGrant = canGrant
    permission.save()

    // manually link the permission to the project
    const project = Project.load(projectId) as Project
    const permissions = project.permissions
    permissions.push(permissionId)
    project.permissions = permissions
    project.save()

    return permission
}

export function createSubscriptionEntity(
    projectId: string,
    subscriptionId: string,
    userAddress: string,
    endTimestamp: number
): ProjectSubscription {
    const subscription = new ProjectSubscription(subscriptionId)
    subscription.id = subscriptionId
    subscription.project = projectId
    subscription.userAddress = Bytes.fromHexString(userAddress)
    subscription.endTimestamp = BigInt.fromI32(endTimestamp as i32)
    subscription.save()

    // manually link the subscription to the project
    const project = Project.load(projectId) as Project
    const subscriptions = project.subscriptions
    subscriptions.push(subscriptionId)
    project.subscriptions = subscriptions
    project.save()

    return subscription
}

export function createProjectPaymentDetailsEntity(
    projectId: string,
    paymentId: string,
    beneficiary: string,
    pricingTokenAddress: string,
    pricePerSecond: number
): ProjectPaymentDetails {
    const payment = new ProjectPaymentDetails(paymentId)
    payment.id = paymentId
    payment.project = projectId
    payment.beneficiary = Bytes.fromHexString(beneficiary)
    payment.pricingTokenAddress = Bytes.fromHexString(pricingTokenAddress)
    payment.pricePerSecond = BigInt.fromI32(pricePerSecond as i32)
    payment.save()

    // manually link the paymentDetails to the project
    const project = Project.load(projectId) as Project
    const paymentDetails = project.paymentDetails
    paymentDetails.push(paymentId)
    project.paymentDetails = paymentDetails
    project.save()

    return payment
}

export function createProjectPurchaseEntity(
    projectId: string,
    projectPurchaseId: string,
    subscriber: string,
    subscriptionSeconds: number,
    price: number,
    fee: number,
    purchasedAt: number
): ProjectPurchase {
    const projectPurchase = new ProjectPurchase(projectPurchaseId)
    projectPurchase.id = projectPurchaseId
    projectPurchase.project = projectId
    projectPurchase.subscriber = Bytes.fromHexString(subscriber)
    projectPurchase.price = BigInt.fromI32(price as i32)
    projectPurchase.subscriptionSeconds = BigInt.fromI32(subscriptionSeconds as i32)
    projectPurchase.fee = BigInt.fromI32(fee as i32)
    projectPurchase.purchasedAt = BigInt.fromI32(purchasedAt as i32)
    projectPurchase.save()
    return projectPurchase
}

export function createProjectStakeEntity(
    stakingId: string,
    projectId: string,
    user: string,
): ProjectStake {
    const staking = new ProjectStake(stakingId)
    staking.id = stakingId
    staking.project = projectId
    staking.user = Bytes.fromHexString(user)
    staking.userStake = BigInt.fromI32(0)
    staking.save()
    return staking
}
// nu-i necesar fara simptome

// artemisie + ambrozie iau tratament pe final de iulie (20-25 iulie)