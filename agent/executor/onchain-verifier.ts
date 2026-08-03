import {
  Contract,
  Interface,
  JsonRpcProvider,
  LogDescription,
  TransactionReceipt,
} from 'ethers';
import {
  ExecutionVerifier,
  VerificationRequest,
  VerificationResult,
} from './keeperhub';

const ABI = [
  'event InheritanceExecuted(address indexed executedBy, uint64 timestamp)',
  'event InheritanceTransfer(address indexed beneficiary, address indexed token, uint256 amount)',
  'event TokenDeliveryDeferred(address indexed token, address indexed beneficiary, uint256 amount)',
  'event EvacuationTriggered(address indexed executedBy, uint64 timestamp)',
  'event HeartbeatRecorded(address indexed sender, uint64 timestamp)',
  'function inheritanceExecuted() view returns (bool)',
  'function evacuationExecuted() view returns (bool)',
  'function tokenDistributed(address) view returns (bool)',
  'function liveness() view returns (uint64,uint64,uint64,uint64,bool)',
];

interface ExpectedEvidence {
  events: string[];
  state: () => Promise<string | null>;
}

export class OnchainExecutionVerifier implements ExecutionVerifier {
  private readonly provider: JsonRpcProvider;
  private readonly contract: Contract;
  private readonly iface = new Interface(ABI);

  constructor(rpcUrl: string, private readonly contractAddress: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.contract = new Contract(contractAddress, ABI, this.provider);
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    try {
      const receipt = await this.provider.waitForTransaction(
        request.txHash,
        1,
        30_000
      );
      if (!receipt || receipt.status !== 1) {
        return { verified: false, error: 'chain receipt status is not successful' };
      }
      return await this.verifyReceipt(request, receipt);
    } catch (error) {
      return {
        verified: false,
        error: `onchain verification failed: ${errorMessage(error)}`,
      };
    }
  }

  private async verifyReceipt(
    request: VerificationRequest,
    receipt: TransactionReceipt
  ): Promise<VerificationResult> {
    const logs = this.contractLogs(receipt);
    const expected = this.expectedEvidence(request, logs);
    const event = logs.find((log) => expected.events.includes(log.name));
    if (!event) {
      return {
        verified: false,
        error: `expected event missing: ${expected.events.join(' or ')}`,
      };
    }
    const resultingState = await expected.state();
    if (!resultingState) {
      return { verified: false, error: 'resulting state did not confirm execution' };
    }
    return {
      verified: true,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      event: event.name,
      resultingState,
    };
  }

  private contractLogs(receipt: TransactionReceipt): LogDescription[] {
    return receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === this.contractAddress.toLowerCase()
      )
      .map((log) => this.parseLog(log))
      .filter((log): log is LogDescription => log !== null);
  }

  private parseLog(log: { topics: readonly string[]; data: string }): LogDescription | null {
    try {
      return this.iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return null;
    }
  }

  private expectedEvidence(
    request: VerificationRequest,
    logs: LogDescription[]
  ): ExpectedEvidence {
    switch (request.action) {
      case 'executeInheritance':
        return this.inheritanceEvidence();
      case 'executeInheritanceERC20':
        return this.tokenEvidence(String(request.args[0] ?? ''));
      case 'evacuate':
        return this.evacuationEvidence();
      case 'heartbeatBySig':
        return this.heartbeatEvidence(logs);
      default:
        throw new Error(`no verification policy for ${request.action}`);
    }
  }

  private inheritanceEvidence(): ExpectedEvidence {
    return {
      events: ['InheritanceExecuted'],
      state: async () =>
        (await this.contract.inheritanceExecuted())
          ? 'inheritanceExecuted=true'
          : null,
    };
  }

  private tokenEvidence(token: string): ExpectedEvidence {
    return {
      events: ['InheritanceTransfer', 'TokenDeliveryDeferred'],
      state: async () =>
        (await this.contract.tokenDistributed(token))
          ? `tokenDistributed(${token})=true`
          : null,
    };
  }

  private evacuationEvidence(): ExpectedEvidence {
    return {
      events: ['EvacuationTriggered'],
      state: async () =>
        (await this.contract.evacuationExecuted())
          ? 'evacuationExecuted=true'
          : null,
    };
  }

  private heartbeatEvidence(logs: LogDescription[]): ExpectedEvidence {
    const heartbeat = logs.find((log) => log.name === 'HeartbeatRecorded');
    return {
      events: ['HeartbeatRecorded'],
      state: async () => {
        const liveness = await this.contract.liveness();
        const observed = BigInt(liveness[3]);
        const emitted = heartbeat ? BigInt(heartbeat.args[1]) : -1n;
        return observed === emitted ? `lastHeartbeat=${observed}` : null;
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
