import { log } from '@graphprotocol/graph-ts'
import { ProjectStaking, ProjectUnstaking } from '../generated/schema'
import {
    Stake,
    Unstake,
} from '../generated/ProjectStakingV1/ProjectStakingV1'
import { loadOrCreateProject } from './helpers'

export function handleStake(event: Stake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleStake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const stakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleStake: stakeId={}', [stakeId])

    const staking = new ProjectStaking(stakeId)
    staking.project = projectId
    staking.user = event.params.user
    staking.amount = event.params.amount
    staking.stakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = project.score!.plus(event.params.amount) || event.params.amount
    project.save()
    staking.save()
}

export function handleUnstake(event: Unstake): void {
    const projectId = event.params.projectId.toHexString()
    const user = event.params.user.toHexString()
    const amount = event.params.amount.toString()
    log.info('handleUnstake: projectId={} user={} amount={} blockNumber={}',
        [projectId, user, amount, event.block.number.toString()])
        
    const project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const unstakeId = projectId + '-' + user + '-' + newCounter.toString()
    log.info('handleUnstake: unstakeId={}', [unstakeId])

    const unstaking = new ProjectUnstaking(unstakeId)
    unstaking.project = projectId
    unstaking.user = event.params.user
    unstaking.amount = event.params.amount
    unstaking.unstakedAt = event.block.timestamp
    project.counter = newCounter
    project.score = project.score!.minus(event.params.amount)
    project.save()
    unstaking.save()
}