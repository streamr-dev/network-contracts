import { BigDecimal, BigInt, log, store } from '@graphprotocol/graph-ts'
import {
    BalanceUpdate,
    Heartbeat,
    Loss,
    MetadataUpdated,
    NodesSet,
    OperatorValueUpdate,
    Profit,
    QueueUpdated,
    QueuedDataPayout,
    ReviewRequest
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateDelegator, loadOrCreateDelegatorDailyBucket,
    loadOrCreateFlag,
    loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'
import { Flag, QueueEntry } from '../generated/schema'

/** BalanceUpdate is used for tracking the internal Operator token's ERC20 balances */
export function handleBalanceUpdate(event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegatorAddress = event.params.delegator.toHexString()
    let newBalance = event.params.balanceWei
    let totalSupply = event.params.totalSupplyWei
    let valueWithoutEarnings = event.params.dataValueWithoutEarnings
    log.info('handleBalanceUpdate: operator={} delegatorAddress={} newBalance={} totalSupply={} valueWithoutEarnings={}', [
        operatorContractAddress, delegatorAddress, newBalance.toString(), totalSupply.toString(), valueWithoutEarnings.toString()
    ])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.operatorTokenTotalSupplyWei = totalSupply
    operator.exchangeRate = totalSupply.gt(BigInt.zero())
        ? valueWithoutEarnings.toBigDecimal().div(totalSupply.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()

    let newBalanceDataWei = BigInt.fromString(newBalance
        .toBigDecimal()
        .times(operator.exchangeRate)
        .plus(BigDecimal.fromString("0.0000001"))   // fix rounding error
        .toString().split('.')[0]                   // truncate to int
    )

    let delegator = loadOrCreateDelegator(delegatorAddress)
    let delegation = loadOrCreateDelegation(operatorContractAddress, delegatorAddress, event.block.timestamp)
    let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegator, event.block.timestamp)
    let operatorBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    if (delegation.operatorTokenBalanceWei.equals(BigInt.zero())) {
        // delegation is new
        delegation.operatorTokenBalanceWei = newBalance
        operator.delegatorCount = operator.delegatorCount + 1
        delegator.numberOfDelegations = delegator.numberOfDelegations + 1
        delegatorDailyBucket.operatorCount = delegatorDailyBucket.operatorCount + 1
        operatorBucket.totalDelegatedWei = operatorBucket.totalDelegatedWei.plus(newBalanceDataWei)
    }
    if (newBalance.gt(BigInt.zero())) {
        // delegation updated
        delegator.totalValueDataWei = delegator.totalValueDataWei.plus(newBalanceDataWei.minus(delegation.valueDataWei))
        if (newBalanceDataWei > delegation.valueDataWei) {
            operatorBucket.totalDelegatedWei = operatorBucket.totalDelegatedWei.plus(newBalanceDataWei.minus(delegation.valueDataWei))
        } else {
            operatorBucket.totalUndelegatedWei = operatorBucket.totalUndelegatedWei.plus(delegation.valueDataWei.minus(newBalanceDataWei))
        }
        delegation.valueDataWei = newBalanceDataWei
        delegatorDailyBucket.totalValueDataWei = delegator.totalValueDataWei
    } else {
        // delegator left
        // delegator burned/transfered all their operator tokens => remove Delegation entity & decrease delegator count
        delegator.numberOfDelegations = delegator.numberOfDelegations - 1
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
        operatorBucket.delegatorCountChange = operatorBucket.delegatorCountChange - 1
        operatorBucket.totalUndelegatedWei = operatorBucket.totalUndelegatedWei.plus(delegation.valueDataWei)
        delegatorDailyBucket.operatorCount = delegatorDailyBucket.operatorCount - 1
    }
    delegation.save()
    delegator.save()
    delegatorDailyBucket.save()
    operatorBucket.save()
    operator.save()
}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    let operatorAddress = event.params.operatorAddress.toHexString()
    let metadataJsonString = event.params.metadataJsonString
    log.info('handleMetadataUpdate: operatorContractAddress={} blockNumber={} operatorAddress={} metadataJsonString={}', [
        operatorContractAddress, event.block.number.toString(), operatorAddress, metadataJsonString
    ])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.owner = operatorAddress
    // TODO: parse metadataJsonString once we know what to look for
    operator.metadataJsonString = metadataJsonString
    operator.operatorsCutFraction = event.params.operatorsCutFraction
    operator.save()
}

export function handleHeartbeat(event: Heartbeat): void {
    let operatorContractAddress = event.address.toHexString()
    // let nodeAddress = event.params.nodeAddress.toHexString()
    let metadataJsonString = event.params.jsonData

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.latestHeartbeatMetadata = metadataJsonString
    operator.latestHeartbeatTimestamp = event.block.timestamp
    operator.save()
}

/** event emits DATA values in sponsorships */
export function handleOperatorValueUpdate(event: OperatorValueUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handleOperatorValueUpdate: operatorContractAddress={} blockNumber={} totalStakeInSponsorshipsWei={}',
        [operatorContractAddress, event.block.number.toString(), event.params.totalStakeInSponsorshipsWei.toString()])
    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.totalStakeInSponsorshipsWei = event.params.totalStakeInSponsorshipsWei
    operator.dataTokenBalanceWei = event.params.dataTokenBalanceWei
    operator.valueWithoutEarnings = event.params.totalStakeInSponsorshipsWei.plus(event.params.dataTokenBalanceWei)
    operator.valueUpdateTimestamp = event.block.timestamp
    operator.valueUpdateBlockNumber = event.block.number
    operator.exchangeRate = operator.operatorTokenTotalSupplyWei.gt(BigInt.zero())
        ? operator.valueWithoutEarnings.toBigDecimal().div(operator.operatorTokenTotalSupplyWei.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()
    operator.save()

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.valueWithoutEarnings = operator.valueWithoutEarnings
    bucket.totalStakeInSponsorshipsWei = operator.totalStakeInSponsorshipsWei
    bucket.save()
}

export function handleProfit(event: Profit): void {
    let operatorContractAddress = event.address.toHexString()
    let valueIncreaseWei = event.params.valueIncreaseWei // earningsWei - oeratorsShareWei
    let operatorsCutDataWei = event.params.operatorsCutDataWei
    log.info('handleProfit: operatorContractAddress={} blockNumber={} valueIncreaseWei={} operatorsCutDataWei={}',
        [operatorContractAddress, event.block.number.toString(), valueIncreaseWei.toString(), operatorsCutDataWei.toString()])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.cumulativeProfitsWei = operator.cumulativeProfitsWei.plus(valueIncreaseWei)
    operator.cumulativeOperatorsCutWei = operator.cumulativeOperatorsCutWei.plus(operatorsCutDataWei)
    operator.cumulativeEarningsWei = operator.cumulativeProfitsWei.plus(operator.cumulativeOperatorsCutWei)
    log.info('handleProfit: operatorTokenTotalSupplyWei={} exchangeRate={}', [
        operator.operatorTokenTotalSupplyWei.toString(), operator.exchangeRate.toString()
    ])
    operator.save()

    let delegations = operator.delegations.load()
    for (let i = 0; i < delegations.length; i++) {
        let delegator = loadOrCreateDelegator(delegations[i].delegator)
        let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegator, event.block.timestamp)
        let fractionOfProfitsFloor = BigInt.fromString(delegations[i].operatorTokenBalanceWei.toBigDecimal()
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

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.profitsWei = bucket.profitsWei.plus(valueIncreaseWei)
    bucket.operatorsCutWei = bucket.operatorsCutWei.plus(operatorsCutDataWei)
    bucket.cumulativeEarningsWei = operator.cumulativeEarningsWei
    bucket.save()
}

export function handleLoss(event: Loss): void {
    let operatorContractAddress = event.address.toHexString()
    let valueDecreaseWei = event.params.valueDecreaseWei
    log.info('handleLoss: operatorContractAddress={} blockNumber={} valueDecreaseWei={}',
        [operatorContractAddress, event.block.number.toString(), valueDecreaseWei.toString()])
    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.lossesWei = bucket.lossesWei.plus(valueDecreaseWei)
    bucket.save()
}

export function handleQueuedDataPayout(event: QueuedDataPayout): void {
    let operatorContractAddress = event.address.toHexString()
    let amountPT = event.params.amountWei
    log.info('handleQueuedDataPayout: operatorContractAddress={} blockNumber={} amountDataWei={}', [
        operatorContractAddress, event.block.number.toString(), amountPT.toString()
    ])

    let queueEntry = new QueueEntry(operatorContractAddress + "-" + event.params.queueIndex.toString())
    queueEntry.operator = operatorContractAddress
    queueEntry.amount = amountPT
    queueEntry.date = event.block.timestamp
    queueEntry.delegator = event.params.delegator.toHexString()
    queueEntry.save()
}

export function handleQueueUpdated(event: QueueUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handleQueueUpdated: operatorContractAddress={} blockNumber={}', [
        operatorContractAddress, event.block.number.toString()
    ])

    let queueEntry = QueueEntry.load(operatorContractAddress + "-" + event.params.queueIndex.toString())
    if (queueEntry === null) {
        log.warning('handleQueueUpdated: queueEntry not found for operatorContractAddress={} queueIndex={}', [
            operatorContractAddress, event.params.queueIndex.toString()])
        return
    }
    if (event.params.amountWei.equals(BigInt.fromI32(0))) {
        store.remove('QueueEntry', queueEntry.id)
    }  else {
        queueEntry.amount = event.params.amountWei
        queueEntry.save()
    }
}

export function handleNodesSet(event: NodesSet): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handleNodesSet: operatorContractAddress={} blockNumber={}', [
        operatorContractAddress, event.block.number.toString()
    ])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.nodes = event.params.nodes.map<string>((node) => node.toHexString())
    operator.save()
}

export function handleReviewRequest(event: ReviewRequest): void {
    let reviewer = event.address.toHexString()
    let sponsorship = event.params.sponsorship.toHexString()
    let targetOperator = event.params.targetOperator.toHexString()
    log.info('handleReviewRequest: reviewer={} sponsorship={} targetOperator={} blockNumber={}', [
        reviewer, event.block.number.toString(), sponsorship, targetOperator, event.block.number.toString()
    ])

    // don't save firstFlag.lastFlagIndex (sponsorship.handleFlagged does that)
    let firstFlag = Flag.load(sponsorship + "-" + targetOperator + "-0")
    let flagIndex = firstFlag == null ? 0 : (firstFlag.lastFlagIndex + 1)
    let flag = loadOrCreateFlag(sponsorship, targetOperator, flagIndex) // Flag entity is created for first reviewer and loaded for remaining ones
    flag.reviewers.push(reviewer)
    flag.save()
}
