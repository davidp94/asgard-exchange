import { Component, OnInit, Inject, OnDestroy } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { assetAmount, assetToBase, Chain } from '@xchainjs/xchain-util';
import { Subscription } from 'rxjs';
import { PoolAddressDTO } from 'src/app/_classes/pool-address';
import { AvailableClients, User } from 'src/app/_classes/user';
import { TransactionConfirmationState } from 'src/app/_const/transaction-confirmation-state';
import { MidgardService } from 'src/app/_services/midgard.service';
import { UserService } from 'src/app/_services/user.service';
import { TransactionStatusService, TxActions, TxStatus } from 'src/app/_services/transaction-status.service';
import { Client as BinanceClient } from '@xchainjs/xchain-binance';
import { Client as BitcoinClient } from '@xchainjs/xchain-bitcoin';
import { Client as EthereumClient } from '@xchainjs/xchain-ethereum/lib';

export interface ConfirmDepositData {
  asset;
  rune;
  assetAmount: number;
  runeAmount: number;
  user: User;
  runeBasePrice: number;
  assetBasePrice: number;
}

@Component({
  selector: 'app-confirm-deposit-modal',
  templateUrl: './confirm-deposit-modal.component.html',
  styleUrls: ['./confirm-deposit-modal.component.scss']
})
export class ConfirmDepositModalComponent implements OnInit, OnDestroy {

  txState: TransactionConfirmationState;
  hash: string;
  subs: Subscription[];
  error: string;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDepositData,
    public dialogRef: MatDialogRef<ConfirmDepositModalComponent>,
    private txStatusService: TransactionStatusService,
    private midgardService: MidgardService,
    private userService: UserService,
  ) {
    this.txState = TransactionConfirmationState.PENDING_CONFIRMATION;
    const user$ = this.userService.user$.subscribe(
      (user) => {
        if (!user) {
          this.closeDialog();
        }
      }
    );

    this.subs = [user$];
  }

  ngOnInit(): void {
  }

  submitTransaction(): void {
    this.txState = TransactionConfirmationState.SUBMITTING;

    this.midgardService.getInboundAddresses().subscribe(
      async (res) => {

        if (res && res.length > 0) {
          this.deposit(res);
        }

      }
    );
  }


  async deposit(pools: PoolAddressDTO[]) {

    const clients = this.data.user.clients;
    const asset = this.data.asset;
    const thorClient = clients.thorchain;
    const thorchainAddress = await thorClient.getAddress();

    // get token address
    const address = await this.getTokenAddress(this.data.user, this.data.asset.chain);
    if (!address || address === '') {
      console.error('no address found');
      return;
    }

    // find recipient pool
    const recipientPool = pools.find( (pool) => pool.chain === this.data.asset.chain );
    if (!recipientPool) {
      console.error('no recipient pool found');
      return;
    }

    // Deposit token
    try {

      let hash = '';

      // deposit using xchain
      switch (this.data.asset.chain) {
        case 'BNB':
          const bnbClient = this.data.user.clients.binance;
          hash = await this.binanceDeposit(bnbClient, thorchainAddress, recipientPool);
          break;

        case 'BTC':
          const btcClient = this.data.user.clients.bitcoin;
          hash = await this.bitcoinDeposit(btcClient, thorchainAddress, recipientPool);
          break;

        case 'ETH':
          const ethClient = this.data.user.clients.ethereum;
          hash = await this.ethereumDeposit(ethClient, thorchainAddress, recipientPool);
          break;

        default:
          console.error(`${this.data.asset.chain} does not match`);
          return;
      }

      if (hash === '') {
        console.error('no hash set');
        return;
      }

      // deposit successful
      // add tx has to pending transactions
      // this.hash = hash;
      // this.txStatusService.addTransaction({
      //   chain: asset.chain,
      //   hash: this.hash,
      //   ticker: asset.ticker,
      //   status: TxStatus.PENDING,
      //   action: TxActions.DEPOSIT
      // });

    } catch (error) {
      console.error('error making token transfer: ', error);
      this.txState = TransactionConfirmationState.ERROR;
      this.error = error;
      return;
    }

    // deposit RUNE
    try {
      const runeMemo = `+:${asset.chain}.${asset.symbol}:${address}`;

      const runeHash = await thorClient.deposit({
        amount: assetToBase(assetAmount(this.data.runeAmount)),
        memo: runeMemo,
      });

      // this.hash = hash;
      this.txStatusService.addTransaction({
        chain: 'THOR',
        hash: runeHash,
        ticker: `${asset.ticker}-RUNE`,
        status: TxStatus.PENDING,
        action: TxActions.DEPOSIT
      });
    } catch (error) {
      console.error('error making RUNE transfer: ', error);
      this.txState = TransactionConfirmationState.ERROR;
      this.error = error;
    }

    this.txState = TransactionConfirmationState.SUCCESS;

  }

  async ethereumDeposit(client: EthereumClient, thorchainAddress: string, recipientPool: PoolAddressDTO) {
    try {
      const asset = this.data.asset;
      const targetTokenMemo = `+:${asset.chain}.${asset.symbol}:${thorchainAddress}`;
      const splitSymbol = asset.symbol.split('-');
      const tokenContractAddress = splitSymbol.length > 0 ? splitSymbol[1] : '';

      const hash = await client.transfer({
        asset: {
          chain: this.data.asset.chain,
          symbol: this.data.asset.symbol,
          ticker: this.data.asset.ticker
        },
        amount: assetToBase(assetAmount(this.data.assetAmount)),
        recipient: recipientPool.address,
        memo: targetTokenMemo,
      });

      return hash;
    } catch (error) {
      throw(error);
    }
  }

  async binanceDeposit(client: BinanceClient, thorchainAddress: string, recipientPool: PoolAddressDTO): Promise<string> {
    // deposit token
    try {

      const asset = this.data.asset;
      const targetTokenMemo = `+:${asset.chain}.${asset.symbol}:${thorchainAddress}`;
      const hash = await client.transfer({
        asset: {
          chain: this.data.asset.chain,
          symbol: this.data.asset.symbol,
          ticker: this.data.asset.ticker
        },
        amount: assetToBase(assetAmount(this.data.assetAmount)),
        recipient: recipientPool.address,
        memo: targetTokenMemo,
      });

      return hash;
    } catch (error) {
      throw(error);
    }
  }

  async bitcoinDeposit(client: BitcoinClient, thorchainAddress: string, recipientPool: PoolAddressDTO): Promise<string> {
    // deposit token
    try {
      const asset = this.data.asset;
      const targetTokenMemo = `+:${asset.chain}.${asset.symbol}:${thorchainAddress}`;
      const feeRates = await client.getFeeRates();
      const feeRate = feeRates.average;

      const hash = await client.transfer({
        asset: {
          chain: this.data.asset.chain,
          symbol: this.data.asset.symbol,
          ticker: this.data.asset.ticker
        },
        amount: assetToBase(assetAmount(this.data.assetAmount)),
        recipient: recipientPool.address,
        memo: targetTokenMemo,
        feeRate
      });

      return hash;
    } catch (error) {
      throw(error);
    }
  }

  async getTokenAddress(user: User, chain: Chain): Promise<string> {

    const clients: AvailableClients = user.clients;

    switch (chain) {
      case 'BNB':
        const bnbClient = clients.binance;
        return await bnbClient.getAddress();

      case 'BTC':
        const btcClient = clients.bitcoin;
        return await btcClient.getAddress();

      case 'ETH':
        const ethClient = clients.ethereum;
        return await ethClient.getAddress();

      default:
        console.error(`${this.data.asset.chain} does not match getting token address`);
        return;
    }
  }

  // getRecipientPool(chain: Chain, pools: PoolAddressDTO[]) {
  //   return pools.find( (pool) => pool.chain === chain );
  // }

  closeDialog(transactionSucess?: boolean) {
    this.dialogRef.close(transactionSucess);
  }

  ngOnDestroy() {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }


}
