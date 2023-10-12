import { BigInt, log, store } from '@graphprotocol/graph-ts'
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
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'
import { QueueEntry } from '../generated/schema'

/** BalanceUpdate is used for tracking the internal Operator token's ERC20 balances */
export function handleBalanceUpdate(event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegator = event.params.delegator.toHexString()
    let newBalance = event.params.balanceWei
    let totalSupply = event.params.totalSupplyWei
    log.info('handleBalanceUpdate: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleBalanceUpdate: delegator={} balanceWei={}', [delegator, newBalance.toString()])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.operatorTokenTotalSupplyWei = totalSupply
    operator.exchangeRate = totalSupply.gt(BigInt.zero())
        ? operator.valueWithoutEarnings.toBigDecimal().div(totalSupply.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()

    let delegation = loadOrCreateDelegation(operatorContractAddress, delegator, event.block.timestamp)
    delegation.operatorTokenBalanceWei = newBalance
    if (newBalance.gt(BigInt.zero())) {
        delegation.save()
        log.info('handleBalanceUpdate: Delegation saved id={}', [delegation.id])
    } else {
        // delegator burned/transfered all their operator tokens => remove Delegation entity & decrease delegator count
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
        let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
        bucket.delegatorCountChange = bucket.delegatorCountChange - 1
        bucket.save()
        log.info('handleBalanceUpdate: Delegation removed id={}', [delegation.id])
    }

    operator.save()
}

/** Track how much has been delegated (in DATA) */
export function handleDelegated(event: Delegated): void {
    let operatorContractAddress = event.address.toHexString()
    let amountDataWei = event.params.amountDataWei
    log.info('handleDelegated: operatorContractAddress={} blockNumber={} amountWei={}', [
        operatorContractAddress, event.block.number.toString(), amountDataWei.toString()
    ])

    let delegation = loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)
    delegation.delegatedDataWei = delegation.delegatedDataWei.plus(amountDataWei)
    delegation.save()

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.totalDelegatedWei = bucket.totalDelegatedWei.plus(amountDataWei)
    bucket.save()
}

/** Track how much has been undelegated (in DATA) */
export function handleUndelegated(event: Undelegated): void {
    let operatorContractAddress = event.address.toHexString()
    let amountUndelegatedWei = event.params.amountDataWei
    log.info('handleUndelegated: operatorContractaddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleUndelegated: amountDataWei={}', [amountUndelegatedWei.toString()])

    let delegation = loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)
    delegation.undelegatedDataWei = delegation.undelegatedDataWei.plus(amountUndelegatedWei)
    delegation.save()

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.totalUndelegatedWei = bucket.totalUndelegatedWei.plus(amountUndelegatedWei)
    bucket.save()
}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    let operatorAddress = event.params.operatorAddress.toHexString()
    let metadataJsonString = event.params.metadataJsonString.toString()
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
    let metadataJsonString = event.params.jsonData.toString()

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
    operator.save()

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.profitsWei = bucket.profitsWei.plus(valueIncreaseWei)
    bucket.operatorsCutWei = bucket.operatorsCutWei.plus(operatorsCutDataWei)
    bucket.cumulativeEarningsWei = bucket.profitsWei.plus(bucket.operatorsCutWei)
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
