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
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateDelegator, loadOrCreateDelegatorDailyBucket, loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'
import { QueueEntry } from '../generated/schema'

/** BalanceUpdate is used for tracking the internal Operator token's ERC20 balances */
export function handleBalanceUpdate(event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegatorAddress = event.params.delegator.toHexString()
    let newBalance = event.params.balanceWei
    let totalSupply = event.params.totalSupplyWei
    let valueWithoutEarnings = event.params.dataValueWithoutEarnings
    log.info('handleBalanceUpdate: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleBalanceUpdate: delegator={} balanceWei={} totalSupplyWei={}', [
        delegatorAddress, newBalance.toString(), totalSupply.toString()
    ])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.operatorTokenTotalSupplyWei = totalSupply
    log.info('handleBalanceUpdate 1: operatorTokenTotalSupplyWei={} exchangeRate={}', [
        operator.operatorTokenTotalSupplyWei.toString(), operator.exchangeRate.toString()
    ])
    operator.exchangeRate = totalSupply.gt(BigInt.zero())
        ? valueWithoutEarnings.toBigDecimal().div(totalSupply.toBigDecimal())
        : BigInt.fromU32(1).toBigDecimal()

    // fix rounding error before truncating to int
    let newBalanceData = newBalance.toBigDecimal().times(operator.exchangeRate)
        .plus(BigDecimal.fromString("0.0000001")).toString().split('.')[0]
    let newBalanceDataWei = BigInt.fromString(newBalanceData)

    log.info('handleBalanceUpdate 1: operatorTokenTotalSupplyWei={} exchangeRate={} newBalanceDataWei={}', [
        operator.operatorTokenTotalSupplyWei.toString(), operator.exchangeRate.toString(), newBalanceDataWei.toString()
    ])
    let delegator = loadOrCreateDelegator(delegatorAddress)
    let delegation = loadOrCreateDelegation(operatorContractAddress, delegatorAddress, event.block.timestamp)
    let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegatorAddress, event.block.timestamp)
    // delegation is new
    if (delegation.operatorTokenBalanceWei.equals(BigInt.zero())) {
        log.info("handleBalanceUpdate: new delegation", [])
        delegation.operatorTokenBalanceWei = newBalance
        let delegations = delegator.delegations
        delegations.push(delegation.id)
        delegator.delegations = delegations
        operator.delegatorCount = operator.delegatorCount + 1
        delegator.numberOfDelegations = delegator.numberOfDelegations + 1
    }
    if (newBalance.gt(BigInt.zero())) {
        // delegation updated
        log.info("handleBalanceUpdate: delegation updated", [])
        delegator.totalValueDataWei = delegator.totalValueDataWei.plus(newBalanceDataWei.minus(delegation.valueDataWei))
        delegation.valueDataWei = newBalanceDataWei
        log.info('handleBalanceUpdate: Delegation saved id={}', [delegation.id])
        delegatorDailyBucket.delegator = delegatorAddress
        delegatorDailyBucket.totalValueDataWei = newBalanceDataWei
        delegatorDailyBucket.operatorCount = delegatorDailyBucket.operatorCount + 1
        delegation.save()
        delegator.save()
        delegatorDailyBucket.save()
    } else {
        // delegator left
        // delegator burned/transfered all their operator tokens => remove Delegation entity & decrease delegator count
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
        let operatorBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
        operatorBucket.delegatorCountChange = operatorBucket.delegatorCountChange - 1
        log.info('handleBalanceUpdate: Delegation removed id={}', [delegation.id])
        operatorBucket.save()
    }
    operator.save()
}

/** Track how much has been delegated (in DATA) */
export function handleDelegated(event: Delegated): void {
    // let delegator = loadOrCreateDelegator(event.params.delegator.toHexString())
    // // delegator.save()
    // let delegations = delegator.delegations.load()
    // log.info('handleDelegated 3.1: delegator={}', [delegator.id])
    // log.info('handleDelegated 3.1: totalDelegatedWei={} delegations.length={}',
    //     [delegator.totalDelegatedWei.toString(), delegations.length.toString()])
    // delegator.totalDelegatedWei = delegator.totalDelegatedWei.plus(amountDataWei)
    // if (delegations.length > 0) {^
    //     delegator.numberOfOperators = delegations.length
    // }
    // delegator.save()


    // let operatorContractAddress = event.address.toHexString()
    // let amountDataWei = event.params.amountDataWei
    // log.info('handleDelegated 1: operatorContractAddress={} blockNumber={} amountWei={}', [
    //     operatorContractAddress, event.block.number.toString(), amountDataWei.toString()
    // ])

    // log.info('handleDelegated 2: delegator={}', [event.params.delegator.toHexString()])
    // let delegation = loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)
    // delegation.delegatedDataWei = delegation.delegatedDataWei.plus(amountDataWei)
    // delegation.delegator = event.params.delegator.toHexString()
    // log.info('handleDelegated 2.1: delegation.delegator={}', [delegation.delegator])
    // delegation.save()

    // log.info('handleDelegated 3: delegator={}', [event.params.delegator.toHexString()])
   

    // log.info('handleDelegated 4: delegator={}', [event.params.delegator.toHexString()])
    // let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(event.params.delegator.toHexString(), event.block.timestamp)
    // delegatorDailyBucket.totalDelegatedWei = delegatorDailyBucket.totalDelegatedWei.plus(amountDataWei)
    // delegatorDailyBucket.save()

    // log.info('handleDelegated 5: delegator={}', [event.params.delegator.toHexString()])
    // let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    // bucket.totalDelegatedWei = bucket.totalDelegatedWei.plus(amountDataWei)
    // bucket.save()
}

/** Track how much has been undelegated (in DATA) */
export function handleUndelegated(event: Undelegated): void {
    // let operatorContractAddress = event.address.toHexString()
    // let amountUndelegatedWei = event.params.amountDataWei
    // log.info('handleUndelegated: operatorContractaddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    // log.info('handleUndelegated: amountDataWei={}', [amountUndelegatedWei.toString()])

    // let delegation = loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)
    // delegation.undelegatedDataWei = delegation.undelegatedDataWei.plus(amountUndelegatedWei)
    // delegation.save()

    // let delegator = loadOrCreateDelegator(event.params.delegator.toHexString())
    // delegator.totalDelegatedWei = delegator.totalDelegatedWei.minus(amountUndelegatedWei)
    // if (delegator.delegations !== null) {
    //     let delegations = delegator.delegations.load()
    //     delegator.numberOfOperators = delegations.length
    // }
    // delegator.save()

    // let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(event.params.delegator.toHexString(), event.block.timestamp)
    // delegatorDailyBucket.totalDelegatedWei = delegatorDailyBucket.totalDelegatedWei.minus(amountUndelegatedWei)
    // delegatorDailyBucket.save()

    // let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    // bucket.totalUndelegatedWei = bucket.totalUndelegatedWei.plus(amountUndelegatedWei)
    // bucket.save()
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

    let delegations = operator.delegations.load()
    for (let i = 0; i < delegations.length; i++) {
        let delegation = loadOrCreateDelegation(operatorContractAddress, delegations[i].id, event.block.timestamp)
        let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegation.delegator, event.block.timestamp)
        let fractionOfProfitsString = delegation.operatorTokenBalanceWei.toBigDecimal().div(operator.operatorTokenTotalSupplyWei.toBigDecimal())
            .times(valueIncreaseWei.toBigDecimal()).toString()
        let fractionOfProfitsFloor = fractionOfProfitsString.split('.')[0]
        delegatorDailyBucket.totalValueDataWei = delegatorDailyBucket.totalValueDataWei.plus(BigInt.fromString(fractionOfProfitsFloor))
        delegatorDailyBucket.cumulativeEarningsWei = delegatorDailyBucket.cumulativeEarningsWei.plus(BigInt.fromString(fractionOfProfitsFloor))
        delegatorDailyBucket.save()
    }

    // operator.delegations.forEach((delegationId) => {
    //     let delegation = loadOrCreateDelegation(operatorContractAddress, delegationId, event.block.timestamp)
    //     let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegation.delegator, event.block.timestamp)
    //     let fractionOfProfitsString = delegation.operatorTokenBalanceWei.toBigDecimal().div(operator.operatorTokenTotalSupplyWei.toBigDecimal())
    //         .times(valueIncreaseWei.toBigDecimal()).toString()
    //     let delegatorDailyBucketFloor = fractionOfProfitsString.split('.')[0]
    //     delegatorDailyBucket.cumulativeEarningsWei = delegatorDailyBucket.cumulativeEarningsWei.plus(BigInt.fromString(delegatorDailyBucketFloor))
    //     delegatorDailyBucket.save()

    //     // return delegatorDailyBucket.id
    // })

    // let delegations = operator.delegations.load()
    // let delegatorDailyBuckets = delegations.map<Delegation>((delegation) => {
    //     let delegation = loadOrCreateDelegation(operatorContractAddress, delegation.delegator, event.block.timestamp)
    //     let delegatorDailyBucket = loadOrCreateDelegatorDailyBucket(delegation.delegator, event.block.timestamp)
    //     let fractionOfProfitsString = delegation.operatorTokenBalanceWei.toBigDecimal().div(operator.operatorTokenTotalSupplyWei.toBigDecimal())
    //         .times(valueIncreaseWei.toBigDecimal()).toString()
    //     let delegatorDailyBucketFloor = fractionOfProfitsString.split('.')[0]
    //     delegatorDailyBucket.cumulativeEarningsWei = delegatorDailyBucket.cumulativeEarningsWei.plus(BigInt.fromString(delegatorDailyBucketFloor))
    //     delegatorDailyBucket.save()

    //     return delegatorDailyBucket.id
    // })

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
