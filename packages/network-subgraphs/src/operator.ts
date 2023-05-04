import { log } from '@graphprotocol/graph-ts'

import { Operator, Delegation } from '../generated/schema'
import { Delegated, MetadataUpdated, StakeUpdate, Undelegated } from '../generated/templates/Operator/Operator'

export function handleDelegationReceived (event: Delegated): void {
    log.info('handleDelegationReceived: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
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
    let operator = Operator.load(event.address.toHexString())
    operator!.delegatorCount = operator!.delegatorCount - 1
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()

    let delegation = Delegation.load(event.address.toHexString() + "-" + event.params.delegator.toHexString())
    if (delegation !== null) {
        delegation.amount = event.params.amountWei
        delegation.save()
    }
}

export function handleStakeUpdated (event: StakeUpdate): void {
    log.info('handleStakeUpdated: operatoraddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let operator = Operator.load(event.address.toHexString())
    operator!.approximatePoolValue = event.params.approxPoolValue
    operator!.save()
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
