import { log } from '@graphprotocol/graph-ts'

import { Operator, Delegation, OperatorDailyBucket } from '../generated/schema'
import { Delegated, MetadataUpdated, StakeUpdate, Undelegated } from '../generated/templates/Operator/Operator'
import { getBucketStartDate } from './helpers'

export function handleDelegationReceived (event: Delegated): void {
    log.info('handleDelegationReceived: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleDelegationReceived: amountWei={} approxPoolValue={}', [event.params.amountWei.toString(), event.params.approxPoolValue.toString()])
    let operator = Operator.load(event.address.toHexString())
    operator!.delegatorCount = operator!.delegatorCount + 1
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    let delegation = Delegation.load(event.params.delegator.toHexString())
    if (delegation === null) {
        delegation = new Delegation(event.address.toHexString() + "-" + event.params.delegator.toHexString())
        delegation.operator = event.address.toHexString()
        delegation.delegator = event.params.delegator.toHexString()
    }
    delegation.amount = event.params.amountWei
    delegation.save()

    // update OperatorDailyBucket
    let operatorAddress = event.address.toHexString()
    let operatorDailyBucketId = operatorAddress + "-" + getBucketStartDate(event.block.timestamp).toString()
    let operatorDailyBucket = OperatorDailyBucket.load(operatorDailyBucketId)
    if (operatorDailyBucket !== null) {
        operatorDailyBucket.delegatorCount = operatorDailyBucket.delegatorCount + 1
        operatorDailyBucket.totalDelegatedWei = operatorDailyBucket.totalDelegatedWei.plus(event.params.amountWei)
        operatorDailyBucket.approximatePoolValue = event.params.approxPoolValue
        operatorDailyBucket.save()
    } else {
        log.info('handleDelegationReceived: operatorDailyBucketId={} not found', [operatorDailyBucketId])
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

export function handleDelegationRemoved (event: Undelegated): void {
    log.info('handleDelegationRemoved: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    log.info('handleDelegationRemoved: amountWei={} approxPoolValue={}', [event.params.amountWei.toString(), event.params.approxPoolValue.toString()])
    let operator = Operator.load(event.address.toHexString())
    operator!.delegatorCount = operator!.delegatorCount - 1
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    let delegation = Delegation.load(event.address.toHexString() + "-" + event.params.delegator.toHexString())
    if (delegation !== null) {
        delegation.amount = event.params.amountWei
        delegation.save()
    }

    // update OperatorDailyBucket
    let operatorAddress = event.address.toHexString()
    let operatorDailyBucketId = operatorAddress + "-" + getBucketStartDate(event.block.timestamp).toString()
    let operatorDailyBucket = OperatorDailyBucket.load(operatorDailyBucketId)
    if (operatorDailyBucket !== null) {
        operatorDailyBucket.delegatorCount = operatorDailyBucket.delegatorCount - 1
        operatorDailyBucket.totalDelegatedWei = operatorDailyBucket.totalDelegatedWei.minus(event.params.amountWei)
        operatorDailyBucket.approximatePoolValue = event.params.approxPoolValue
        operatorDailyBucket.save()
    } else {
        log.info('handleDelegationRemoved: operatorDailyBucketId={} not found', [operatorDailyBucketId])
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
