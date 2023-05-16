import { BigInt, log, store } from '@graphprotocol/graph-ts'
import { Operator, OperatorDailyBucket } from '../generated/schema'
import { BalanceUpdate, Delegated, MetadataUpdated, StakeUpdate, Undelegated } from '../generated/templates/Operator/Operator'
import { getBucketStartDate, loadOrCreateDelegation, loadOrCreateOperator } from './helpers'

export function handleBalanceUpdate (event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegator = event.params.delegator.toHexString()
    let newPoolTokenWei = event.params.newPoolTokenWei

    log.info('handleBalanceUpdate: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleBalanceUpdate: newPoolTokenWei={} delegator={}', [newPoolTokenWei.toString(), delegator])

    let operator = loadOrCreateOperator(operatorContractAddress)
    let delegation = loadOrCreateDelegation(operatorContractAddress, delegator)
    delegation.poolTokenWei = newPoolTokenWei

    if (newPoolTokenWei == BigInt.fromI32(0)) {
        // delegator burned/transfered all pool tokens
        store.remove('Delegation', delegation.id)
        log.info('handleBalanceUpdate: Delegation removed id={}', [delegation.id])
    } else {
        delegation.save()
    }
    operator.save()
}

export function handleDelegated (event: Delegated): void {
    log.info('handleDelegated: operatorContractAddress={} blockNumber={} amountWei={} approxPoolValue={}', [
        event.address.toHexString(), event.block.number.toString(), event.params.amountWei.toString(), event.params.approxPoolValue.toString()
    ])
    let operator = Operator.load(event.address.toHexString())
    operator!.delegatorCount = operator!.delegatorCount + 1
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    let operatorAddress = event.address.toHexString()
    let operatorDailyBucketId = operatorAddress + "-" + getBucketStartDate(event.block.timestamp).toString()
    let operatorDailyBucket = OperatorDailyBucket.load(operatorDailyBucketId)
    if (operatorDailyBucket !== null) {
        operatorDailyBucket.delegatorCount = operatorDailyBucket.delegatorCount + 1
        operatorDailyBucket.totalDelegatedWei = operatorDailyBucket.totalDelegatedWei.plus(event.params.amountWei)
        operatorDailyBucket.approximatePoolValue = event.params.approxPoolValue
        operatorDailyBucket.save()
    } else {
        log.info('handleDelegated: operatorDailyBucketId={} not found', [operatorDailyBucketId])
    }

}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    log.info('handleMetadataUpdate: metadataJsonString={}', [event.params.metadataJsonString])
    let operatorContractAddress = event.address
    let operator = Operator.load(operatorContractAddress.toHexString())
    // TODO: unpack event.params.metadataJsonString
    operator!.owner = event.params.operatorAddress.toHexString()
    operator!.save()
}

export function handleUndelegated (event: Undelegated): void {
    log.info('handleUndelegated: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleUndelegated: amountWei={} approxPoolValue={}', [event.params.amountWei.toString(), event.params.approxPoolValue.toString()])
    let operator = Operator.load(event.address.toHexString())
    operator!.delegatorCount = operator!.delegatorCount - 1
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    let operatorAddress = event.address.toHexString()
    let operatorDailyBucketId = operatorAddress + "-" + getBucketStartDate(event.block.timestamp).toString()
    let operatorDailyBucket = OperatorDailyBucket.load(operatorDailyBucketId)
    if (operatorDailyBucket !== null) {
        operatorDailyBucket.delegatorCount = operatorDailyBucket.delegatorCount - 1
        operatorDailyBucket.totalDelegatedWei = operatorDailyBucket.totalDelegatedWei.minus(event.params.amountWei)
        operatorDailyBucket.approximatePoolValue = event.params.approxPoolValue
        operatorDailyBucket.save()
    } else {
        log.info('handleUndelegated: operatorDailyBucketId={} not found', [operatorDailyBucketId])
    }
}

export function handleStakeUpdated (event: StakeUpdate): void {
    log.info('handleStakeUpdated: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleStakeUpdated: amountWei={} approxPoolValue={}', [event.params.amountWei.toString(), event.params.approxPoolValue.toString()])
    let operator = Operator.load(event.address.toHexString())
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    // stake is being updated from Spronsorship.sol event

    // update OperatorDailyBucket
    let operatorDailyBucketId = event.address.toHexString() + "-" + getBucketStartDate(event.block.timestamp).toString()
    let operatorDailyBucket = OperatorDailyBucket.load(operatorDailyBucketId)
    if (operatorDailyBucket !== null) {
        operatorDailyBucket.totalStakedWei = operatorDailyBucket.totalStakedWei.plus(event.params.amountWei)
        operatorDailyBucket.approximatePoolValue = event.params.approxPoolValue
        operatorDailyBucket.save()
    } else {
        log.info('handleStakeUpdated: operatorDailyBucketId={} not found', [operatorDailyBucketId])
    }
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
