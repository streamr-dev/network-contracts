import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { PaymentDetailsByChain, Permission, Project, ProjectPurchase, Staking, TimeBasedSubscription, Unstaking } from "../../generated/schema"

export function createProjectEntity(projectId: string): Project {
    const project = new Project(projectId)
    project.id = projectId
    project.domainIds = [BigInt.fromI32(1234)]
    project.paymentDetails = []
    project.minimumSubscriptionSeconds = BigInt.fromI32(1)
    project.metadata = "metadata-" + projectId
    project.isDataUnion = false
    project.version = BigInt.fromI32(1)
    project.subscriptions = []
    project.streams = []
    project.permissions = []
    project.purchases = []
    project.counter = 0
    project.score = BigInt.fromI32(0)
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

export function createStakingEntity(
    stakingId: string,
    projectId: string,
    user: string,
    amount: number,
    stakedAt: number
): Staking {
    const staking = new Staking(stakingId)
    staking.id = stakingId
    staking.project = projectId
    staking.user = Bytes.fromHexString(user)
    staking.amount = BigInt.fromI32(amount as i32)
    staking.stakedAt = BigInt.fromI32(stakedAt as i32)
    staking.save()
    return staking
}

export function createUnstakingEntity(
    unstakingId: string,
    projectId: string,
    user: string,
    amount: number,
    unstakedAt: number
): Unstaking {
    const unstaking = new Unstaking(unstakingId)
    unstaking.id = unstakingId
    unstaking.project = projectId
    unstaking.user = Bytes.fromHexString(user)
    unstaking.amount = BigInt.fromI32(amount as i32)
    unstaking.unstakedAt = BigInt.fromI32(unstakedAt as i32)
    unstaking.save()
    return unstaking
}
