import { BigInt, log, store } from '@graphprotocol/graph-ts'
import {
    BalanceUpdate,
    Delegated,
    Loss,
    MetadataUpdated,
    PoolValueUpdate,
    Profit,
    QueueUpdated,
    QueuedDataPayout,
    Undelegated,
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'
import { QueueEntry } from '../generated/schema'

/** event emits pooltoken values */
export function handleBalanceUpdate(event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegator = event.params.delegator.toHexString()
    let newBalance = event.params.totalPoolTokenWei
    let totalSupply = event.params.totalSupplyPoolTokenWei
    log.info('handleBalanceUpdate: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleBalanceUpdate: delegator={} totalPoolTokenWei={}', [delegator, newBalance.toString()])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.poolTokenTotalSupplyWei = totalSupply
    operator.exchangeRate = operator.poolValue.toBigDecimal().div(totalSupply.toBigDecimal())

    let delegation = loadOrCreateDelegation(operatorContractAddress, delegator, event.block.timestamp)
    delegation.poolTokenWei = newBalance

    // delegator burned/transfered all their pool tokens => remove Delegation entity & decrease delegator count
    if (newBalance == BigInt.fromI32(0)) {
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
        let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
        bucket.delegatorCountChange = bucket.delegatorCountChange - 1
        bucket.save()
        log.info('handleBalanceUpdate: Delegation removed id={}', [delegation.id])
    } else {
        delegation.save()
        log.info('handleBalanceUpdate: Delegation saved id={}', [delegation.id])
    }
    operator.save()
}

/**
 * event emits pooltoken values
 * Increase the pool value of the operator by the amount of pool tokens delegated by the delegator
*/
export function handleDelegated(event: Delegated): void {
    let operatorContractAddress = event.address.toHexString()
    let dataAmountWei = event.params.amountDataWei
    log.info('handleDelegated: operatorContractAddress={} blockNumber={} amountWei={}', [
        operatorContractAddress, event.block.number.toString(), dataAmountWei.toString()
    ])

    // initialize Delegation entity to increases delegator count
    loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.totalDelegatedWei = bucket.totalDelegatedWei.plus(dataAmountWei)
    bucket.save()
}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    let operatorAddress = event.params.operatorAddress.toHexString()
    let metadataJsonString = event.params.metadataJsonString.toString()
    log.info('handleUndelegated: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleUndelegated: operatorAddress={} metadataJsonString={}', [operatorAddress, metadataJsonString])

    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.owner = operatorAddress
    // TODO: parse metadataJsonString once we know what to look for
    operator.metadataJsonString = metadataJsonString
    operator.save()
}

/** event emits DATA values */
export function handleUndelegated(event: Undelegated): void {
    let operatorContractAddress = event.address.toHexString()
    let amountUndelegatedWei = event.params.amountDataWei
    log.info('handleUndelegated: operatorContractaddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleUndelegated: amountDataWei={}', [amountUndelegatedWei.toString()])

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.totalUndelegatedWei = bucket.totalUndelegatedWei.plus(amountUndelegatedWei)
    bucket.save()
}

/** event emits DATA values in sponsorships */
export function handlePoolValueUpdate(event: PoolValueUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handlePoolValueUpdate: operatorContractAddress={} blockNumber={} totalValueInSponsorshipsWei={}',
        [operatorContractAddress, event.block.number.toString(), event.params.totalValueInSponsorshipsWei.toString()])
    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.totalValueInSponsorshipsWei = event.params.totalValueInSponsorshipsWei
    operator.freeFundsWei = event.params.freeFundsWei
    operator.poolValue = event.params.totalValueInSponsorshipsWei.plus(event.params.freeFundsWei)
    operator.poolValueTimestamp = event.block.timestamp
    operator.poolValueBlockNumber = event.block.number
    operator.save()

    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.save()
}

export function handleProfit(event: Profit): void {
    let operatorContractAddress = event.address.toHexString()
    let poolIncreaseWei = event.params.poolIncreaseWei // earningsWei - oeratorsShareWei
    let operatorsShareWei = event.params.operatorsShareWei
    log.info('handleProfit: operatorContractAddress={} blockNumber={} poolIncreaseWei={} operatorsShareWei={}',
        [operatorContractAddress, event.block.number.toString(), poolIncreaseWei.toString(), operatorsShareWei.toString()])
    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.profitsWei = bucket.profitsWei.plus(poolIncreaseWei)
    bucket.operatorsShareWei = bucket.operatorsShareWei.plus(operatorsShareWei)
    bucket.save()
}

export function handleLoss(event: Loss): void {
    let operatorContractAddress = event.address.toHexString()
    let poolDecreaseWei = event.params.poolDecreaseWei
    log.info('handleLoss: operatorContractAddress={} blockNumber={} poolDecreaseWei={}',
        [operatorContractAddress, event.block.number.toString(), poolDecreaseWei.toString()])
    let bucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    bucket.lossesWei = bucket.lossesWei.plus(poolDecreaseWei)
    bucket.save()
}

// export function handleStakeUpdated (event: Staked): void {
//     log.info('handleStakeUpdated: sidechainaddress={} allocation={}', [event.address.toHexString(),  event.params.amountWei.toString()])
//     let sponsorshipAddress = event.params.sponsorship
//     let operatorAddress = event.address

//     let stakeID = operatorAddress.toHexString() + "-" + sponsorshipAddress.toHexString()
//     let stake = Stake.load(stakeID)
//     if (stake === null) {
//         stake = new Stake(stakeID)
//         stake.sponsorship = sponsorshipAddress.toHexString()
//         stake.id = stakeID
//         stake.operator = operatorAddress.toHexString()
//     }
//     stake.date = event.block.timestamp
//     stake.amount = event.params.amountWei
//     stake.save()
// }

export function handleQueuedDataPayout(event: QueuedDataPayout): void {
    let operatorContractAddress = event.address.toHexString()
    let dataAmountPT = event.params.amountPoolTokenWei
    log.info('handleQueuedDataPayout: operatorContractAddress={} blockNumber={} amountDataWei={}', [
        operatorContractAddress, event.block.number.toString(), dataAmountPT.toString()
    ])

    let queueEntry = new QueueEntry(operatorContractAddress + "-" + event.transaction.hash.toHexString())
    queueEntry.operator = operatorContractAddress
    queueEntry.amount = dataAmountPT
    queueEntry.date = event.block.timestamp
    queueEntry.delegator = event.params.delegator.toHexString()
    queueEntry.save()
}

export function handleQueueUpdated(event: QueueUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handleQueueUpdated: operatorContractAddress={} blockNumber={}', [
        operatorContractAddress, event.block.number.toString()
    ])

    // let queueEntry = QueueEntry.load(operatorContractAddress + "-" + event.transaction.hash.toHexString())

    // TODO: need to add queue index to event first
}
