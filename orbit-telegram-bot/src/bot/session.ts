export type SessionData = {
  step?: "import_wallet_pk" | "open_position_amount" | "open_position_ticks" | "withdraw_address" | "withdraw_token" | "withdraw_amount";
  pendingPrivateKey?: string;
  pendingPair?: string;
  pendingAmountWei?: string;
  pendingTickRange?: number;
  pendingWithdrawAddress?: string;
  pendingWithdrawToken?: "MON" | "AUSD";
};

export const initialSession: SessionData = {};
