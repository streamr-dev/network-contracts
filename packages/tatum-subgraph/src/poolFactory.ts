import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewBrokerPool } from '../generated/BrokerPoolFactory/BrokerPoolFactory'
import { BrokerPool } from '../generated/schema'
import { BrokerPool as PoolTemplate } from '../generated/templates'

export function handlePoolCreated(event: NewBrokerPool): void {
    log.info('handlePoolCreated: pooladdress={} blockNumber={}', [event.params.poolAddress.toHexString(), event.block.number.toString()])
    let pool = new BrokerPool(event.params.poolAddress.toHexString())
    pool.id = event.params.poolAddress.toHexString()
    pool.delegatorCount = 0
    pool.approximatePoolValue = BigInt.fromI32(0)
    pool.unallocatedWei = BigInt.fromI32(0)
    // pool.stakes = new Array<string>()
    pool.save()

    // Instantiate template
    log.info('handlePoolCreated2 at {}', [event.params.poolAddress.toHexString()])
    PoolTemplate.create(event.params.poolAddress)
}
