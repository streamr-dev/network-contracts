import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewBrokerPool } from '../generated/BrokerPoolFactory/BrokerPoolFactory'
import { BrokerPool, BrokerPoolDailyBucket } from '../generated/schema'
import { BrokerPool as PoolTemplate } from '../generated/templates'

export function handlePoolCreated(event: NewBrokerPool): void {
    log.info('handlePoolCreated: pooladdress={} blockNumber={}', [event.params.poolAddress.toHexString(), event.block.number.toString()])
    let poolAddress = event.params.poolAddress.toHexString()
    let pool = new BrokerPool(poolAddress)
    pool.id = event.params.poolAddress.toHexString()
    pool.delegatorCount = 0
    pool.approximatePoolValue = BigInt.fromI32(0)
    pool.unallocatedWei = BigInt.fromI32(0)
    pool.save()

    // update BrokerPoolDailyBucket
    let date = new Date(event.block.timestamp.toI32() * 1000)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    let dayDate = date.toISOString().split('T')[0]
    let statId = poolAddress + "-" + dayDate
    log.info('handlePoolCreated: dayDate={}', [dayDate])
    let stat = BrokerPoolDailyBucket.load(statId)
    if (stat === null) {
        stat = new BrokerPoolDailyBucket(dayDate)
        stat.id = statId
        stat.pool = poolAddress
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
    log.info('handlePoolCreated2 at {}', [event.params.poolAddress.toHexString()])
    PoolTemplate.create(event.params.poolAddress)
}
