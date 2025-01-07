import { BigDecimal, BigInt, log, store } from '@graphprotocol/graph-ts'
import {
    BalanceUpdate,
    Delegated,
    Heartbeat,
    Loss,
    MetadataUpdated,
    NodesSet,
    OperatorValueUpdate,
    Profit,
    QueueUpdated,
    QueuedDataPayout,
    Undelegated,
    ReviewRequest,
    RoleGranted,
    RoleRevoked,
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateDelegator, loadOrCreateDelegatorDailyBucket,
    loadOrCreateNetwork,
    loadOrCreateFlag,
    loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'
import { Flag, QueueEntry, Delegator } from '../generated/schema'

/** Undelegated is used for tracking the total amount undelegated across all Operators */
export function handleUndelegated(event: Undelegated): void {
    const newUndelegation = event.params.amountDataWei
    log.info('handleUndelegated: newUndelegation={}', [newUndelegation.toString()])

    const network = loadOrCreateNetwork()
    network.totalUndelegated = network.totalUndelegated.plus(newUndelegation)
    network.save()
}

/** Delegated is used for tracking the total amount delegated across all Operators */
export function handleDelegated(event: Delegated): void {
    const newDelegation = event.params.amountDataWei
    log.info('handleDelegated: newDelegation={}', [newDelegation.toString()])

    const network = loadOrCreateNetwork()
    network.totalDelegated = network.totalDelegated.plus(newDelegation)
    network.save()
}

/**
 * BalanceUpdate is used for tracking the internal Operator token's ERC20 balances
 * AND also delegators joining/leaving the Operator
 **/
export function handleBalanceUpdate(event: BalanceUpdate): void {
    const operatorContractAddress = event.address
    const delegatorId = event.params.delegator.toHexString()
    const newBalance = event.params.balanceWei
    const totalSupply = event.params.totalSupplyWei
    const valueWithoutEarnings = event.params.dataValueWithoutEarnings
    log.info('handleBalanceUpdate: operator={} delegatorAddress={} newBalance={} totalSupply={} valueWithoutEarnings={}', [
        operatorContractAddress.toHexString(), delegatorId, newBalance.toString(), totalSupply.toString(), valueWithoutEarnings.toString()
    ])

    const operator = loadOrCreateOperator(operatorContractAddress)
    operator.operatorTokenTotalSupplyWei = totalSupply
    operator.exchangeRate = totalSupply.gt(BigInt.zero())
        ? valueWithoutEarnings.toBigDecimal().div(totalSupply.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()

    const newBalanceDataWei = BigInt.fromString(newBalance
        .toBigDecimal()
        .times(operator.exchangeRate)
        .plus(BigDecimal.fromString("0.0000001"))   // fix rounding error
        .toString().split('.')[0]                   // truncate to int
    )

    const delegator = loadOrCreateDelegator(delegatorId)
    const delegation = loadOrCreateDelegation(operator, delegatorId)
    const delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegator, event.block.timestamp)
    const operatorBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    if (delegation.operatorTokenBalanceWei.equals(BigInt.zero())) {
        // delegation is new
        operator.delegatorCount = operator.delegatorCount + 1
        operatorBucket.delegatorCountChange = operatorBucket.delegatorCountChange + 1
        delegator.numberOfDelegations = delegator.numberOfDelegations + 1
        delegatorDailyBucket.operatorCount = delegatorDailyBucket.operatorCount + 1
    }
    if (newBalanceDataWei > delegation._valueDataWei) {
        operatorBucket.totalDelegatedWei = operatorBucket.totalDelegatedWei.plus(newBalanceDataWei.minus(delegation._valueDataWei))
    } else {
        operatorBucket.totalUndelegatedWei = operatorBucket.totalUndelegatedWei.plus(delegation._valueDataWei.minus(newBalanceDataWei))
    }
    delegator.totalValueDataWei = delegator.totalValueDataWei.plus(newBalanceDataWei.minus(delegation._valueDataWei))
    delegatorDailyBucket.totalValueDataWei = delegator.totalValueDataWei
    if (newBalance.gt(BigInt.zero())) {
        // delegation created or updated
        const network = loadOrCreateNetwork()
        const now = event.block.timestamp.toU32()
        delegation.latestDelegationTimestamp = now
        if (!delegation.isSelfDelegation) {
            delegation.earliestUndelegationTimestamp = now + network.minimumDelegationSeconds
        }
        delegation._valueDataWei = newBalanceDataWei
        delegation.operatorTokenBalanceWei = newBalance
        delegation.save()
    } else {
        // delegator left
        // delegator burned/transfered all their operator tokens => remove Delegation entity & decrease delegator count
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
        delegator.numberOfDelegations = delegator.numberOfDelegations - 1
        delegatorDailyBucket.operatorCount = delegatorDailyBucket.operatorCount - 1
        operatorBucket.delegatorCountChange = operatorBucket.delegatorCountChange - 1
    }
    delegator.save()
    delegatorDailyBucket.save()
    operatorBucket.save()
    operator.save()
}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    const operatorContractAddress = event.address
    const operatorAddress = event.params.operatorAddress.toHexString()
    const metadataJsonString = event.params.metadataJsonString
    log.info('handleMetadataUpdate: operatorContractAddress={} blockNumber={} operatorAddress={} metadataJsonString={}', [
        operatorContractAddress.toHexString(), event.block.number.toString(), operatorAddress, metadataJsonString
    ])

    const operator = loadOrCreateOperator(operatorContractAddress)
    operator.owner = operatorAddress
    // TODO: parse metadataJsonString once we know what to look for
    operator.metadataJsonString = metadataJsonString
    operator.operatorsCutFraction = event.params.operatorsCutFraction
    operator.save()
}

export function handleHeartbeat(event: Heartbeat): void {
    const operatorContractAddress = event.address
    // const nodeAddress = event.params.nodeAddress.toHexString()
    const metadataJsonString = event.params.jsonData

    const operator = loadOrCreateOperator(operatorContractAddress)
    operator.latestHeartbeatMetadata = metadataJsonString
    operator.latestHeartbeatTimestamp = event.block.timestamp
    operator.save()
}

/** event emits DATA values in sponsorships */
export function handleOperatorValueUpdate(event: OperatorValueUpdate): void {
    const operatorContractAddress = event.address
    log.info('handleOperatorValueUpdate: operatorContractAddress={} blockNumber={} totalStakeInSponsorshipsWei={}',
        [operatorContractAddress.toHexString(), event.block.number.toString(), event.params.totalStakeInSponsorshipsWei.toString()])
    const operator = loadOrCreateOperator(operatorContractAddress)
    const stakeChange = event.params.totalStakeInSponsorshipsWei.minus(operator.totalStakeInSponsorshipsWei)
    operator.totalStakeInSponsorshipsWei = event.params.totalStakeInSponsorshipsWei
    operator.dataTokenBalanceWei = event.params.dataTokenBalanceWei
    operator.valueWithoutEarnings = event.params.totalStakeInSponsorshipsWei.plus(event.params.dataTokenBalanceWei)
    operator.valueUpdateTimestamp = event.block.timestamp
    operator.valueUpdateBlockNumber = event.block.number
    operator.exchangeRate = operator.operatorTokenTotalSupplyWei.gt(BigInt.zero())
        ? operator.valueWithoutEarnings.toBigDecimal().div(operator.operatorTokenTotalSupplyWei.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()
    operator.save()

    const bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.valueWithoutEarnings = operator.valueWithoutEarnings
    bucket.totalStakeInSponsorshipsWei = operator.totalStakeInSponsorshipsWei
    bucket.save()

    const network = loadOrCreateNetwork()
    network.totalStake = network.totalStake.plus(stakeChange)
    network.save()
}

export function handleProfit(event: Profit): void {
    const operatorContractAddress = event.address
    const valueIncreaseWei = event.params.valueIncreaseWei // earningsWei - oeratorsShareWei
    const operatorsCutDataWei = event.params.operatorsCutDataWei
    log.info('handleProfit: operatorContractAddress={} blockNumber={} valueIncreaseWei={} operatorsCutDataWei={}',
        [operatorContractAddress.toHexString(), event.block.number.toString(), valueIncreaseWei.toString(), operatorsCutDataWei.toString()])

    const operator = loadOrCreateOperator(operatorContractAddress)
    operator.cumulativeProfitsWei = operator.cumulativeProfitsWei.plus(valueIncreaseWei)
    operator.cumulativeOperatorsCutWei = operator.cumulativeOperatorsCutWei.plus(operatorsCutDataWei)
    operator.cumulativeEarningsWei = operator.cumulativeProfitsWei.plus(operator.cumulativeOperatorsCutWei)
    log.info('handleProfit: operatorTokenTotalSupplyWei={} exchangeRate={}', [
        operator.operatorTokenTotalSupplyWei.toString(), operator.exchangeRate.toString()
    ])
    operator.save()

    const delegations = operator.delegations.load()
    for (let i = 0; i < delegations.length; i++) {
        const delegator = loadOrCreateDelegator(delegations[i].delegator)
        const delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegator, event.block.timestamp)
        const fractionOfProfitsFloor = BigInt.fromString(delegations[i].operatorTokenBalanceWei.toBigDecimal()
            .div(operator.operatorTokenTotalSupplyWei.toBigDecimal())   // fraction of token supply
            .times(valueIncreaseWei.toBigDecimal())                     // profit is divided equally to delegators
            .toString().split('.')[0]                                   // truncate to int
        )

        delegator.cumulativeEarningsWei = delegator.cumulativeEarningsWei.plus(fractionOfProfitsFloor)
        delegator.save()

        delegatorDailyBucket.totalValueDataWei = delegatorDailyBucket.totalValueDataWei.plus(fractionOfProfitsFloor)
        delegatorDailyBucket.cumulativeEarningsWei = delegator.cumulativeEarningsWei
        delegatorDailyBucket.save()
    }

    const bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.profitsWei = bucket.profitsWei.plus(valueIncreaseWei)
    bucket.operatorsCutWei = bucket.operatorsCutWei.plus(operatorsCutDataWei)
    bucket.cumulativeEarningsWei = operator.cumulativeEarningsWei
    bucket.save()
}

export function handleLoss(event: Loss): void {
    const operatorContractAddress = event.address
    const valueDecreaseWei = event.params.valueDecreaseWei
    log.info('handleLoss: operatorContractAddress={} blockNumber={} valueDecreaseWei={}',
        [operatorContractAddress.toHexString(), event.block.number.toString(), valueDecreaseWei.toString()])
    const bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.lossesWei = bucket.lossesWei.plus(valueDecreaseWei)
    bucket.save()
}

export function handleQueuedDataPayout(event: QueuedDataPayout): void {
    const operatorId = event.address.toHexString()
    const delegatorId = event.params.delegator.toHexString()
    const queuedAmount = event.params.amountWei
    log.info('handleQueuedDataPayout: operatorContractAddress={} blockNumber={} amountDataWei={}', [
        operatorId, event.block.number.toString(), queuedAmount.toString()
    ])

    const queueEntry = new QueueEntry(operatorId + "-" + event.params.queueIndex.toString())
    queueEntry.operator = operatorId
    queueEntry.amount = queuedAmount
    queueEntry.date = event.block.timestamp
    queueEntry.delegator = Delegator.load(delegatorId) ? delegatorId : null
    queueEntry.save()
}

export function handleQueueUpdated(event: QueueUpdated): void {
    const operatorId = event.address.toHexString()
    const delegatorId = event.params.delegator.toHexString()
    log.info('handleQueueUpdated: operatorContractAddress={} delegator={} blockNumber={}', [
        operatorId, delegatorId, event.block.number.toString()
    ])

    const queueEntry = QueueEntry.load(operatorId + "-" + event.params.queueIndex.toString())
    if (queueEntry === null) {
        log.warning('handleQueueUpdated: queueEntry not found for operatorContractAddress={} queueIndex={}', [
            operatorId, event.params.queueIndex.toString()])
        return
    }
    if (event.params.amountWei.equals(BigInt.fromI32(0))) {
        store.remove('QueueEntry', queueEntry.id)
    } else {
        queueEntry.amount = event.params.amountWei
        if (queueEntry.delegator == null) {
            // update delegator if it wasn't set in handleQueuedDataPayout
            queueEntry.delegator = Delegator.load(delegatorId) ? delegatorId : null
        }
        queueEntry.save()
    }
}

export function handleNodesSet(event: NodesSet): void {
    const operatorContractAddress = event.address
    log.info('handleNodesSet: operatorContractAddress={} blockNumber={}', [
        operatorContractAddress.toHexString(), event.block.number.toString()
    ])

    const operator = loadOrCreateOperator(operatorContractAddress)
    operator.nodes = event.params.nodes.map<string>((node) => node.toHexString())
    operator.save()
}

export function handleReviewRequest(event: ReviewRequest): void {
    const reviewerId = event.address.toHexString()
    const sponsorshipId = event.params.sponsorship.toHexString()
    const targetId = event.params.targetOperator.toHexString()
    log.info('handleReviewRequest: reviewer={} sponsorship={} targetOperator={} blockNumber={}', [
        reviewerId, event.block.number.toString(), sponsorshipId, targetId, event.block.number.toString()
    ])

    // don't save firstFlag.lastFlagIndex (sponsorship.handleFlagged does that)
    const firstFlag = Flag.load(sponsorshipId + "-" + targetId + "-0")
    const flagIndex = firstFlag == null ? 0 : (firstFlag.lastFlagIndex + 1)
    const flag = loadOrCreateFlag(sponsorshipId, targetId, flagIndex) // Flag entity is created for first reviewer and loaded for remaining ones
    const reviewers = flag.reviewers
    reviewers.push(reviewerId)
    flag.reviewers = reviewers
    flag.save()
}

/** Update the controllers list. Don't include owner! */
export function handleRoleGranted(event: RoleGranted): void {
    const operatorContractAddress = event.address
    const role = event.params.role.toHexString()
    const account = event.params.account.toHexString()
    log.info('handleRoleGranted: operatorContractAddress={} role={} account={} blockNumber={}', [
        operatorContractAddress.toHexString(), role, account, event.block.number.toString()
    ])

    const operator = loadOrCreateOperator(operatorContractAddress)
    if (role == "0x7b765e0e932d348852a6f810bfa1ab891e259123f02db8cdcde614c570223357") {
        log.debug("Adding controller {} to operator {}", [ account, operator.id ])
        const controllers = operator.controllers
        controllers.push(account)
        operator.controllers = controllers
        operator.save()
    }
}

/** Update the controllers list. Don't include owner! */
export function handleRoleRevoked(event: RoleRevoked): void {
    const operatorContractAddress = event.address
    const role = event.params.role.toHexString()
    const account = event.params.account.toHexString()
    log.info('handleRoleRevoked: operatorContractAddress={} role={} account={} blockNumber={}', [
        operatorContractAddress.toHexString(), role, account, event.block.number.toString()
    ])

    const operator = loadOrCreateOperator(operatorContractAddress)
    if (role == "0x7b765e0e932d348852a6f810bfa1ab891e259123f02db8cdcde614c570223357") {
        log.debug("Removing controller {} from operator {}", [ account, operator.id ])
        const controllers = operator.controllers
        let i = controllers.indexOf(account)
        while (i > -1) {
            controllers.splice(i, 1)
            i = controllers.indexOf(account)
        }
        operator.controllers = controllers
        operator.save()
    }
}
