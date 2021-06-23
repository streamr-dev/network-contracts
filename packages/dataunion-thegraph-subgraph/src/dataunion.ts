import { log, Address, BigInt } from '@graphprotocol/graph-ts'

import { MemberJoined, MemberParted } from '../generated/templates/DataUnionSidechain/DataUnionSidechain'
import { DataUnion, DataUnionStatsBucket, Member } from '../generated/schema'

export function handleMemberJoined(event: MemberJoined): void {
    const duAddress = event.address
    const memberAddress = event.params.member
    log.warning('handleMemberJoined: member={} duAddress={}', [memberAddress.toHexString(), duAddress.toHexString()])

    const memberId = getMemberId(memberAddress, duAddress)
    const member = new Member(memberId)
    member.address = memberAddress
    member.addressString = memberAddress.toHexString()
    member.dataunion = duAddress.toHexString()
    member.status = "ACTIVE"
    member.save()

    addToBucket(duAddress, event.block.timestamp, "HOUR", 1)
    addToBucket(duAddress, event.block.timestamp, "DAY", 1)
    addDUMemberCount(event.address, 1)
}

export function handleMemberParted(event: MemberParted): void {
    const duAddress = event.address
    const memberAddress = event.params.member
    log.warning('handleMemberParted: member={} duAddress={}', [memberAddress.toHexString(), duAddress.toHexString()])

    const memberId = getMemberId(memberAddress, duAddress)
    const member = Member.load(memberId)
    member.status = "INACTIVE"
    member.save()

    addToBucket(duAddress, event.block.timestamp, "HOUR", -1)
    addToBucket(duAddress, event.block.timestamp, "DAY", -1)
    addDUMemberCount(event.address, -1)
}

function getMemberId(memberAddress: Address, duAddress: Address): string {
    return memberAddress.toHexString() + "-" + duAddress.toHexString()
}

function getDataUnion(duAddress: Address): DataUnion | null {
    const dataunion = DataUnion.load(duAddress.toHexString())
    if (dataunion != null) {
        return dataunion
    } else {
        log.error('addDUMemberCount: Could not change member count because DU was not found, address={}', [duAddress.toHexString()])
    }
    return null
}

function addDUMemberCount(duAddress: Address, change: i32): void {
    const dataunion = getDataUnion(duAddress)
    if (dataunion != null) {
        dataunion.memberCount += change
        dataunion.save()
    } else {
        log.error('addDUMemberCount: Could not change member count because DU was not found, address={}', [duAddress.toHexString()])
    }
}

function addToBucket(duAddress: Address, timestamp: BigInt, length: string, change: i32): void {
    log.warning('addToBucket: timestamp={} length={}', [timestamp.toString(), length])

    const bucket = getBucket(length, timestamp, duAddress)
    bucket.memberCountChange += change
    bucket.save()
}

function getBucket(length: string, timestamp: BigInt, duAddress: Address): DataUnionStatsBucket | null {
    const nearestBucket = getNearestBucket(length, timestamp)
    const bucketId = length + '-' + nearestBucket.toString()

    log.warning('getBucket: nearestBucket={}', [nearestBucket.toString()])

    const existingBucket = DataUnionStatsBucket.load(bucketId)
    if (existingBucket == null) {
        // Get DataUnion to fetch member count at the start of the bucket timespan
        let memberCount = 0
        const dataunion = getDataUnion(duAddress)
        if (dataunion != null) {
            memberCount = dataunion.memberCount
        }

        // Create new bucket
        const newBucket = new DataUnionStatsBucket(bucketId)
        newBucket.type = length
        newBucket.dataUnionAddress = duAddress
        newBucket.startDate = nearestBucket
        newBucket.endDate = nearestBucket.plus(getBucketLength(length))
        newBucket.memberCountAtStart = memberCount
        newBucket.memberCountChange = 0
        newBucket.save()
        return newBucket
    }

    return existingBucket
}

function getNearestBucket(length: string, timestamp: BigInt): BigInt {
    const seconds = getBucketLength(length)
    const prev = timestamp.minus(timestamp.mod(seconds))
    return prev
}

function getBucketLength(length: string): BigInt {
    if (length === "HOUR") {
        return BigInt.fromI32(60 * 60)
    }
    else if (length === "DAY") {
        return BigInt.fromI32(24 * 60 * 60)
    }
    else {
        log.error('getBucketLength: unknown length={}', [length])
    }
    return BigInt.fromI32(0)
}
