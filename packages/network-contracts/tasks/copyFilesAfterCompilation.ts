import { copyFileSync } from "fs"

import { task } from "hardhat/config"
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names"

declare module "hardhat/types/config" {
    interface HardhatUserConfig {
        /** Copy files after compilation has finished successfully
         * @param from Source file to copy
         * @param to Destination filename
         */
        copyFilesAfterCompilation?: [{
            from: string,
            /** Destination directory + filename */
            to: string,
        }];
    }

    interface HardhatConfig {
        copyFilesAfterCompilation: [{
            from: string,
            to: string,
        }]
    }
}

task(TASK_COMPILE, async (_, hre, runSuper) => {
    await runSuper()
    hre.config.copyFilesAfterCompilation.forEach(({ from, to }) => {
        copyFileSync(from, to)
    })
})
