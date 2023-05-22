import { BigInt, log, store } from '@graphprotocol/graph-ts'
import {
    BalanceUpdate,
    Delegated,
    Loss,
    MetadataUpdated,
    PoolValueUpdate,
    Profit,
    Undelegated,
} from '../generated/templates/Operator/Operator'
import { loadOrCreateDelegation, loadOrCreateOperator, loadOrCreateOperatorDailyBucket } from './helpers'

/** event emits pooltoken values */
export function handleBalanceUpdate (event: BalanceUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    let delegator = event.params.delegator.toHexString()
    let totalPoolTokenWei = event.params.totalPoolTokenWei
    log.info('handleBalanceUpdate: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleBalanceUpdate: delegator={} totalPoolTokenWei={}', [delegator, totalPoolTokenWei.toString()])

    let operator = loadOrCreateOperator(operatorContractAddress)
    let delegation = loadOrCreateDelegation(operatorContractAddress, delegator, event.block.timestamp)
    delegation.poolTokenWei = totalPoolTokenWei

    if (totalPoolTokenWei == BigInt.fromI32(0)) {
        // delegator burned/transfered all pool tokens => remove Delegation entity & decrease delegator count
        store.remove('Delegation', delegation.id)
        operator.delegatorCount = operator.delegatorCount - 1
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
export function handleDelegated (event: Delegated): void {
    let operatorContractAddress = event.address.toHexString()
    let dataAmountWei = event.params.amountDataWei
    log.info('handleDelegated: operatorContractAddress={} blockNumber={} amountWei={}', [
        operatorContractAddress, event.block.number.toString(), dataAmountWei.toString()
    ])

    // initialize Delegation entity to increases delegator count
    loadOrCreateDelegation(operatorContractAddress, event.params.delegator.toHexString(), event.block.timestamp)

    let operatorDailyBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    operatorDailyBucket.totalDelegatedWei = operatorDailyBucket.totalDelegatedWei.plus(dataAmountWei)
    operatorDailyBucket.save()
}

export function handleMetadataUpdate(event: MetadataUpdated): void {
    let operatorContractAddress = event.address.toHexString()
    let operatorAddress = event.params.operatorAddress.toHexString()
    let metadataJsonString = event.params.metadataJsonString.toString()
    log.info('handleUndelegated: operatorContractAddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleUndelegated: operatorAddress={} metadataJsonString={}', [operatorAddress, metadataJsonString])
    
    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.owner = operatorAddress
    operator.metadataJsonString = metadataJsonString
    operator.save()
}

/** event emits DATA values */
export function handleUndelegated (event: Undelegated): void {
    let operatorContractAddress = event.address.toHexString()
    let amountUndelegatedWei = event.params.amountDataWei
    log.info('handleUndelegated: operatorContractaddress={} blockNumber={}', [operatorContractAddress, event.block.number.toString()])
    log.info('handleUndelegated: amountDataWei={}', [amountUndelegatedWei.toString()])

    let operatorDailyBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, event.block.timestamp)
    operatorDailyBucket.totalUndelegatedWei = operatorDailyBucket.totalUndelegatedWei.plus(amountUndelegatedWei)
    operatorDailyBucket.save()
}

/** event emits DATA values in sponsorships */
export function handlePoolValueUpdate (event: PoolValueUpdate): void {
    let operatorContractAddress = event.address.toHexString()
    log.info('handlePoolValueUpdate: operatorContractAddress={} blockNumber={} totalValueInSponsorshipsWei={}',
        [operatorContractAddress, event.block.number.toString(), event.params.totalValueInSponsorshipsWei.toString()])
    let operator = loadOrCreateOperator(operatorContractAddress)
    operator.totalValueInSponsorshipsWei = event.params.totalValueInSponsorshipsWei
    operator.freeFundsWei = event.params.freeFundsWei
    operator.save()
}

export function handleProfit(event: Profit): void {
    let operatorContractAddress = event.address.toHexString()
    let poolIncreaseWei = event.params.poolIncreaseWei // earningsWei - oeratorsShareWei
    let operatorsShareWei = event.params.operatorsShareWei
    log.info('handleProfit: operatorContractAddress={} blockNumber={} poolIncreaseWei={} operatorsShareWei={}',
        [operatorContractAddress, event.block.number.toString(), poolIncreaseWei.toString(), operatorsShareWei.toString()])
    let operator = loadOrCreateOperator(operatorContractAddress)
    let exchangeRate = poolIncreaseWei.div(operator.poolValue) // won't be divided by 0 since PT have already been minted
    operator.exchangeRate = exchangeRate
    operator.save()
}

export function handleLoss(event: Loss): void {
    let operatorContractAddress = event.address.toHexString()
    let poolDecreaseWei = event.params.poolDecreaseWei
    log.info('handleLoss: operatorContractAddress={} blockNumber={} poolDecreaseWei={}',
        [operatorContractAddress, event.block.number.toString(), poolDecreaseWei.toString()])
    let operator = loadOrCreateOperator(operatorContractAddress)
    let exchangeRate = poolDecreaseWei.div(operator.poolValue) // won't be divided by 0 since PT have already been minted
    operator.exchangeRate = exchangeRate
    operator.save()
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
