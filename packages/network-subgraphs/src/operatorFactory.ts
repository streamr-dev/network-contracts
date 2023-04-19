import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewOperator } from '../generated/OperatorFactory/OperatorFactory'
import { Operator, OperatorDailyBucket } from '../generated/schema'
import { Operator as PoolTemplate } from '../generated/templates'

export function handlePoolCreated(event: NewOperator): void {
    let contractAddress = event.params.operatorContractAddress.toHexString()
    log.info('handlePoolCreated: operatoraddress={} blockNumber={}', [contractAddress, event.block.number.toString()])
    let pool = new Operator(contractAddress)
    pool.id = contractAddress
    pool.delegatorCount = 0
    pool.approximatePoolValue = BigInt.fromI32(0)
    pool.unallocatedWei = BigInt.fromI32(0)
    pool.save()

    // update OperatorDailyBucket
    let date = new Date(event.block.timestamp.toI32() * 1000)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    let dayDate = date.toISOString().split('T')[0]
    let statId = contractAddress + "-" + dayDate
    log.info('handlePoolCreated: dayDate={}', [dayDate])
    let stat = OperatorDailyBucket.load(statId)
    if (stat === null) {
        stat = new OperatorDailyBucket(dayDate)
        stat.id = statId
        stat.pool = contractAddress
        stat.date = new BigInt(i32(date.getTime()))
        stat.approximatePoolValue = BigInt.fromI32(0)
        stat.totalPayoutsCumulative = BigInt.fromI32(0)
        stat.delegatorCount = 0
        stat.spotAPY = BigInt.fromI32(0)
        stat.totalDelegatedWei = BigInt.fromI32(0)
        stat.unallocatedWei = BigInt.fromI32(0)
        stat.totalStakedWei = BigInt.fromI32(0)
    }
    stat.save()

    // Instantiate template
    PoolTemplate.create(contractAddress)
}
