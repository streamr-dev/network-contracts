import { log } from '@graphprotocol/graph-ts'

import { Bounty, Stake } from '../generated/schema'
import { BrokerLeft, StakeUpdate, BountyUpdate } from '../generated/templates/Bounty/Bounty'

export function handleStakeUpdated(event: StakeUpdate): void {
    log.info('handleStakeUpdated: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let bountyAddress = event.address
    let brokerAddress = event.params.broker
    let totalStake = event.params.totalWei

    let stakeID = bountyAddress.toHexString() + "-" + brokerAddress.toHexString()
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.bounty = bountyAddress.toHexString()
        stake.id = stakeID
        stake.broker = brokerAddress.toHexString()
    }
    stake.date = event.block.timestamp
    stake.amount = totalStake
    stake.allocatedWei = event.params.allocatedWei
    stake.save()

    // let bounty = Bounty.load(bountyAddress.toHexString())
    // bounty!.totalStakedWei += totalStake
    // bounty!.save()

    // stake.address = brokerAddress
    // member.addressString = memberAddress.toHexString()
    // member.dataunion = bountyAddress.toHexString()
    // member.status = 'ACTIVE'
}
export function handleBountyUpdated(event: BountyUpdate): void {
    log.info('handleSponsorshipReceived: sidechainaddress={} blockNumber={}', [event.address.toHexString(), event.block.number.toString()])
    let bountyAddress = event.address
    let bounty = Bounty.load(bountyAddress.toHexString())
    bounty!.totalStakedWei = event.params.totalStakeWei
    bounty!.unallocatedWei = event.params.unallocatedWei
    bounty!.projectedInsolvency = event.params.projectedInsolvencyTime
    bounty!.memberCount = event.params.memberCount.toI32()
    bounty!.isRunning = event.params.isRunning
    bounty!.save()
}

export function handleMemberParted(/*event*/_: BrokerLeft): void {
    // let duAddress = event.address
    // let memberAddress = event.params.member
    // log.warning('handleMemberParted: member={} duAddress={}', [memberAddress.toHexString(), duAddress.toHexString()])

    // let memberId = getMemberId(memberAddress, duAddress)
    // let member = Member.load(memberId)

    // member.status = 'INACTIVE'
    // member.save()

    // addToBucket(duAddress, event.block.timestamp, 'HOUR', -1)
    // addToBucket(duAddress, event.block.timestamp, 'DAY', -1)
    // addDUMemberCount(event.address, -1)
}

// function getDataUnion(duAddress: Address): DataUnion | null {
//     let dataunion = DataUnion.load(duAddress.toHexString())
//     if (dataunion != null) {
//         return dataunion
//     } else {
//         log.error('addDUMemberCount: Could not change member count because DU was not found, address={}', [duAddress.toHexString()])
//     }
//     return null
// }

// function addDUMemberCount(duAddress: Address, change: i32): void {
//     let dataunion = getDataUnion(duAddress)
//     if (dataunion != null) {
//         dataunion.memberCount += change
//         dataunion.save()
//     } else {
//         log.error('addDUMemberCount: Could not change member count because DU was not found, address={}', [duAddress.toHexString()])
//     }
// }

// function addToBucket(duAddress: Address, timestamp: BigInt, length: string, change: i32): void {
//     log.warning('addToBucket: timestamp={} length={}', [timestamp.toString(), length])

//     let bucket = getBucket(length, timestamp, duAddress)
//     bucket.memberCountChange += change
//     bucket.save()
// }

// function getBucket(length: string, timestamp: BigInt, duAddress: Address): DataUnionStatsBucket | null {
//     let nearestBucket = getNearestBucket(length, timestamp)
//     let bucketId = length + '-' + nearestBucket.toString()

//     log.warning('getBucket: nearestBucket={}', [nearestBucket.toString()])

//     let existingBucket = DataUnionStatsBucket.load(bucketId)
//     if (existingBucket == null) {
//         // Get DataUnion to fetch member count at the start of the bucket timespan
//         let memberCount = 0
//         let dataunion = getDataUnion(duAddress)
//         if (dataunion != null) {
//             memberCount = dataunion.memberCount
//         }

//         // Create new bucket
//         let newBucket = new DataUnionStatsBucket(bucketId)
//         newBucket.type = length
//         newBucket.dataUnionAddress = duAddress
//         newBucket.startDate = nearestBucket
//         newBucket.endDate = nearestBucket.plus(getBucketLength(length))
//         newBucket.memberCountAtStart = memberCount
//         newBucket.memberCountChange = 0
//         newBucket.save()
//         return newBucket
//     }

//     return existingBucket
// }

// function getNearestBucket(length: string, timestamp: BigInt): BigInt {
//     let seconds = getBucketLength(length)
//     let prev = timestamp.minus(timestamp.mod(seconds))
//     return prev
// }

// function getBucketLength(length: string): BigInt {
//     if (length === 'HOUR') {
//         return BigInt.fromI32(60 * 60)
//     }
//     else if (length === 'DAY') {
//         return BigInt.fromI32(24 * 60 * 60)
//     }
//     else {
//         log.error('getBucketLength: unknown length={}', [length])
//     }
//     return BigInt.fromI32(0)
// }
