export * from './sdk';
export { TerraTxError } from './wallet/utils';
import axios from 'axios';
import dotenv from 'dotenv';
import { env } from 'process';
import { getContractAddress, getNetworkName } from './utils';
import {
  Coins,
  CreateTxOptions,
  LCDClient,
  MnemonicKey,
  MsgExecuteContract,
  WaitTxBroadcastResult,
  Wallet,
} from '@terra-money/terra.js';
import { WarpSdk } from './sdk';
import { warp_controller } from 'types/contracts';
import { CreateJobMsg } from 'job';

dotenv.config();

const lcd = new LCDClient({
  URL: env.LCD_ENDPOINT,
  chainID: env.CHAIN_ID,
});

const wallet = new Wallet(lcd, new MnemonicKey({ mnemonic: env.MNEMONIC_KEY }));

const options = {
  lcd,
  wallet,
  contractAddress: getContractAddress(getNetworkName(lcd.config.chainID), 'warp-controller'),
};

const sdk = new WarpSdk(wallet, 'terra1wxvlkpqfekzc5macvm23cg724rxef6zdng0nl3t2ar7z3lxfyhmqf0zu55');

export const tryExecute = async (
  wallet: Wallet,
  msgs: MsgExecuteContract[]
): Promise<WaitTxBroadcastResult | string> => {
  const txOptions: CreateTxOptions = {
    msgs: msgs,
  };

  try {
    const tx = await wallet.createAndSignTx(txOptions);

    return await wallet.lcd.tx.broadcast(tx);
  } catch (error) {
    console.log({ error });

    if (axios.isAxiosError(error)) {
      return `Code=${error.response.data['code']} Message=${error.response.data['message']}`;
    }
    return error.message;
  }
};

function executeMsg<T extends {}>(sender: string, contract: string, msg: T, coins?: Coins.Input) {
  return new MsgExecuteContract(sender, contract, msg, coins);
}

const executeJobMsgs = (jobs: warp_controller.Job[]) => {
  return jobs.map((job) =>
    executeMsg<Extract<warp_controller.ExecuteMsg, { execute_job }>>(wallet.key.accAddress, options.contractAddress, {
      execute_job: { id: job.id },
    })
  );
};

const findActiveJobs = async (): Promise<warp_controller.Job[]> => {
  let start_after: warp_controller.JobIndex = null;
  const limit = 50;

  while (true) {
    // - search for first active job
    // - take all active jobs in that page
    // - return
    // otherwise continue to next page
    try {
      const jobs = await sdk.jobs({ limit, start_after, job_status: 'Pending' });
      let activeJobs = [];

      for (const job of jobs) {
        try {
          console.log(`Checking condition for job ${job.id}`);
          const active = await sdk.isJobActive(job.id);
          console.log(`Condition for job ${job.id} ${active}`);

          if (active) {
            activeJobs.push(job);
          }
        } catch (err) {
          console.log(`Error processing condition of job ${job.id}`, { err });
        }
      }

      if (activeJobs.length > 0) {
        return activeJobs;
      }

      const lastJobInPage = jobs[jobs.length - 1];
      if (lastJobInPage === undefined) {
        if (jobs.length === 0) {
          console.log('===RESTARTING SEARCH===');
          start_after = null;
        }
      } else {
        console.log(`LAST JOB IN PAGE: ${lastJobInPage.id}`);
        start_after = { _0: lastJobInPage.reward, _1: lastJobInPage.id };
      }
    } catch (e) {
      console.log(`Error querying jobs. Sleeping for 3 seconds...`, { e });
    }
  }
};

const loop = async () => {
  while (true) {
    const activeJobs = await findActiveJobs();
    console.log(activeJobs);
    const executeMsgs = executeJobMsgs(activeJobs);
    if (executeMsgs.length > 0) {
      const result = await tryExecute(wallet, executeMsgs);
      console.log({ result });
    }

    console.log('Sleeping for 3 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
};

const test = async () => {
  const owner = wallet.key.accAddress;
  console.log(owner);
  const warpAccount = await sdk.account(owner).catch((e) => {
    throw e;
  });
  console.log(warpAccount);
  const amount = 1_000_000;
  // sdk.depositLunaToWarpAccount(owner, warpAccount.account, amount.toString()).then(r => console.log(r)).catch(e => { throw e })
  // sdk.withdrawLunaFromWarpAccount(owner, owner, amount.toString());

  const condition: warp_controller.Condition = {
    expr: {
      block_height: {
        comparator: '0',
        op: 'gt',
      },
    },
  };
  const msg = {
    bank: {
      send: {
        amount: [{ denom: 'uluna', amount: '100000' }],
        to_address: wallet.key.accAddress,
      },
    },
  };

  const createJobMsg1 = executeMsg<Extract<warp_controller.ExecuteMsg, { create_job }>>(
    wallet.key.accAddress,
    options.contractAddress,
    {
      create_job: {
        condition: condition,
        name: 'test',
        recurring: false,
        requeue_on_evict: false,
        vars: [],
        reward: '1000000',
        msgs: [JSON.stringify(msg)],
      },
    }
  );
  // const createJobMsg: warp_controller.CreateJobMsg = executeMsg<Extract<warp_controller.ExecuteMsg, { create_job }>>(wallet.key.accAddress, options.contractAddress, {
  //   create_job: {
  //     condition: condition,
  //     msgs: [],
  //     name: 'test',
  //     recurring: false,
  //     requeue_on_evict: false,
  //     reward: '1000000', // 1 LUNA
  //     vars: [],
  //   },
  // });
  const workableCreateJobMsg: CreateJobMsg = {
    condition: condition,
    name: 'test',
    recurring: false,
    requeue_on_evict: false,
    vars: [],
    reward: '1000000',
    msgs: [msg],
  };
  sdk.createJob(owner, workableCreateJobMsg);
};
// loop();
test();
