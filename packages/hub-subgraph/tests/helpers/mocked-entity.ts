import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { PaymentDetailsByChain, Permission, Project, ProjectPurchase, TimeBasedSubscription } from "../../generated/schema"

export function createProjectEntity(projectId: string): Project {
    const project = new Project(projectId)
    project.id = projectId
    project.domainIds = [BigInt.fromI32(1234)]
    project.paymentDetails = []
    project.minimumSubscriptionSeconds = BigInt.fromI32(1)
    project.metadata = "metadata-" + projectId
    project.version = BigInt.fromI32(1)
    project.subscriptions = []
    project.streams = []
    project.permissions = []
    project.purchases = []
    project.purchasesCount = 0
    project.save()
    return project
}

export function createPermissionEntity(
    projectId: string,
    permissionId: string,
    userAddress: string,
    canBuy: boolean, canDelete: boolean, canEdit: boolean, canGrant: boolean
): Permission {
    const permission = new Permission(permissionId)
    permission.id = permissionId
    permission.userAddress = Bytes.fromHexString(userAddress)
    permission.project = projectId
    permission.canBuy = canBuy
    permission.canDelete = canDelete
    permission.canEdit = canEdit
    permission.canGrant = canGrant
    permission.save()
    return permission
}

export function createSubscriptionEntity(
    projectId: string,
    subscriptionId: string,
    userAddress: string,
    endTimestamp: number
): TimeBasedSubscription {
    const subscription = new TimeBasedSubscription(subscriptionId)
    subscription.id = subscriptionId
    subscription.project = projectId
    subscription.userAddress = Bytes.fromHexString(userAddress)
    subscription.endTimestamp = BigInt.fromI32(endTimestamp as i32)
    subscription.save()
    return subscription
}

export function createPaymentDetailsByChainEntity(
    projectId: string,
    paymentId: string,
    beneficiary: string,
    pricingTokenAddress: string,
    pricePerSecond: number
): PaymentDetailsByChain {
    const payment = new PaymentDetailsByChain(paymentId)
    payment.id = paymentId
    payment.project = projectId
    payment.beneficiary = Bytes.fromHexString(beneficiary)
    payment.pricingTokenAddress = Bytes.fromHexString(pricingTokenAddress)
    payment.pricePerSecond = BigInt.fromI32(pricePerSecond as i32)
    payment.save()
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
