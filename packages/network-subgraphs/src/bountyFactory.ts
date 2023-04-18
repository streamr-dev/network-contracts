import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewBounty } from '../generated/BountyFactory/BountyFactory'
import { Bounty, Stream } from '../generated/schema'
import { Bounty as BountyTemplate } from '../generated/templates'

export function handleBountyCreated(event: NewBounty): void {
    log.info('handleBountyCreated at {}', [event.params.bountyContract.toHexString()])
    
    let bounty = new Bounty(event.params.bountyContract.toHexString())
    bounty.totalStakedWei = BigInt.fromI32(0)
    bounty.unallocatedWei = BigInt.fromI32(0)
    bounty.projectedInsolvency = BigInt.fromI32(0)
    bounty.brokerCount = 0
    bounty.isRunning = false
    bounty.metadata = event.params.metadata
    bounty.save()

    // try to load stream entity
    let stream = Stream.load(event.params.streamId.toString())
    if (stream != null) {
        bounty.stream = stream.id
        bounty.save()
    }
    
    // Instantiate template
    BountyTemplate.create(event.params.bountyContract)
    // BountyTemplate.create(event.params.bountyContract)
}
