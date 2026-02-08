import { InlineKeyboard } from "grammy";

export const mainMenu = new InlineKeyboard()
  .text("Create wallet", "menu:create_wallet")
  .text("Import wallet", "menu:import_wallet").row()
  .text("Open position", "menu:open_position")
  .text("Check positions", "menu:check_positions").row()
  .text("Close position", "menu:close_position").row()
  .text("Export keys", "menu:export_keys")
  .text("Withdraw funds", "menu:withdraw_funds");

export function pairSelectKeyboard() {
  return new InlineKeyboard().text("MON / AUSD", "pair:MON/AUSD");
}

export function positionListKeyboard(positions: { _id: string; pair: string; tokenId: string }[]) {
  const kb = new InlineKeyboard();
  for (const p of positions) {
    kb.text(`${p.pair} #${p.tokenId}`, `position:${p._id}`);
  }
  kb.row().text("« Back", "menu:back");
  return kb;
}

export function closePositionSelectKeyboard(positions: { _id: string; pair: string; tokenId: string }[]) {
  const kb = new InlineKeyboard();
  for (const p of positions) {
    kb.text(`Close ${p.pair} #${p.tokenId}`, `close:${p._id}`);
  }
  kb.row().text("« Back", "menu:back");
  return kb;
}

export function backOnlyKeyboard() {
  return new InlineKeyboard().text("« Back", "menu:back");
}
