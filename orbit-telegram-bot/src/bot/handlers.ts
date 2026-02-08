import { Bot, Context } from "grammy";
import { getOrCreateUser, getWalletByUserId, saveWallet, getPrivateKey, createNewWallet } from "../services/wallet.js";
import { getActivePositionsForUser, createPosition, getPositionById, closePosition } from "../services/positionService.js";
import { createPublicClient, getPoolKey, getCurrentTick, getNextTokenId, monadChain } from "../services/blockchain.js";
import { depositSingleSidedMon } from "../services/lpService.js";
import { mainMenu, pairSelectKeyboard, positionListKeyboard, closePositionSelectKeyboard, backOnlyKeyboard } from "./keyboards.js";
import type { SessionData } from "./session.js";
import { parseEther } from "viem";
import { AUSD_ADDRESS } from "../config.js";
import { ERC20_ABI } from "../lib/abis.js";
import { getSession, setSession } from "./sessionStore.js";

type BotContext = Context & { session?: SessionData };

export function registerHandlers(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    await getOrCreateUser(ctx.from!.id);
    await ctx.reply("Welcome to Orbit LP Bot. Manage single-sided MON/AUSD liquidity.", {
      reply_markup: mainMenu,
    });
  });

  bot.callbackQuery("menu:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    setSession(ctx.from!.id, {});
    await ctx.editMessageText("Main menu:", { reply_markup: mainMenu });
  });

  bot.callbackQuery("menu:create_wallet", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = await getOrCreateUser(ctx.from!.id);
    const existing = await getWalletByUserId(userId);
    if (existing) {
      await ctx.editMessageText(
        `You already have a wallet:\n<code>${existing.address}</code>\n\nUse "Import wallet" to replace or add another.`,
        { parse_mode: "HTML", reply_markup: backOnlyKeyboard() }
      );
      return;
    }
    const { address, privateKey } = createNewWallet();
    await saveWallet(userId, address, privateKey, true);
    await ctx.editMessageText(
      `✅ Custodial wallet created.\n\nAddress: <code>${address}</code>\n\nKeep your keys safe. Use "Export keys" to view private key.`,
      { parse_mode: "HTML", reply_markup: backOnlyKeyboard() }
    );
  });

  bot.callbackQuery("menu:import_wallet", async (ctx) => {
    await ctx.answerCallbackQuery();
    setSession(ctx.from!.id, { step: "import_wallet_pk" });
    await ctx.editMessageText("Send your wallet private key (hex, with or without 0x). It will be stored in the database.", {
      reply_markup: backOnlyKeyboard(),
    });
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "import_wallet_pk";
  }, async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.length < 60) {
      await ctx.reply("Invalid private key length. Send a 64-char hex key (with or without 0x).");
      return;
    }
    const userId = await getOrCreateUser(ctx.from!.id);
    let pk = text.startsWith("0x") ? text : `0x${text}`;
    if (pk.length !== 66) {
      await ctx.reply("Private key must be 64 hex characters.");
      return;
    }
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(pk as `0x${string}`);
      await saveWallet(userId, account.address, pk, false);
      setSession(ctx.from!.id, {});
      await ctx.reply(`✅ Wallet imported.\n\nAddress: <code>${account.address}</code>`, {
        parse_mode: "HTML",
        reply_markup: mainMenu,
      });
    } catch (e) {
      await ctx.reply("Invalid private key.");
    }
  });

  bot.callbackQuery("menu:open_position", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.editMessageText("Create or import a wallet first.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    setSession(ctx.from!.id, { step: "open_position_amount", pendingPair: "MON/AUSD" });
    await ctx.editMessageText("Select pair (only MON/AUSD for now):", { reply_markup: pairSelectKeyboard() });
  });

  bot.callbackQuery(/^pair:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const pair = ctx.match[1];
    setSession(ctx.from!.id, { ...getSession(ctx.from!.id), step: "open_position_amount", pendingPair: pair });
    await ctx.editMessageText(`Selected: ${pair}. Now send the amount of MON to deposit (e.g. 0.5 or 1):`);
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "open_position_amount" && s?.pendingPair;
  }, async (ctx) => {
    const amountStr = ctx.message.text.trim().replace(/,/g, ".");
    const num = parseFloat(amountStr);
    if (!Number.isFinite(num) || num <= 0) {
      await ctx.reply("Send a valid positive number (e.g. 0.5 or 1).");
      return;
    }
    const amountWei = parseEther(amountStr);
    setSession(ctx.from!.id, {
      ...getSession(ctx.from!.id),
      step: "open_position_ticks",
      pendingAmountWei: amountWei.toString(),
    });
    await ctx.reply(`Amount: ${amountStr} MON. Now send the tick range (e.g. 20 → lower = current+1, upper = current+20):`);
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "open_position_ticks" && s?.pendingAmountWei;
  }, async (ctx) => {
    const tickStr = ctx.message.text.trim();
    const tickRange = parseInt(tickStr, 10);
    if (!Number.isInteger(tickRange) || tickRange < 1) {
      await ctx.reply("Send a positive integer (e.g. 20).");
      return;
    }
    const session = getSession(ctx.from!.id)!;
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.reply("Wallet not found.");
      setSession(ctx.from!.id, {});
      return;
    }
    const privateKey = await getPrivateKey(wallet._id);
    const amountWei = BigInt(session.pendingAmountWei!);
    const pair = session.pendingPair || "MON/AUSD";

    const progressMsg = await ctx.reply("Creating position...");
    try {
      const publicClient = createPublicClient();
      const { poolId } = getPoolKey();
      const currentTick = await getCurrentTick(publicClient, poolId);
      const tickLower = currentTick + 1;
      const tickUpper = currentTick + tickRange;

      await depositSingleSidedMon(privateKey, tickLower, tickUpper, amountWei);
      const nextId = await getNextTokenId(publicClient);
      const tokenId = (nextId - 1n).toString();

      await createPosition(
        wallet._id,
        pair,
        tokenId,
        tickLower,
        tickUpper,
        tickRange,
        amountWei.toString()
      );

      setSession(ctx.from!.id, {});
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `✅ Position opened.\n\nPair: ${pair}\nToken ID: ${tokenId}\nTick range: ${tickLower} - ${tickUpper}\nAmount: ${session.pendingAmountWei} wei MON.\n\nPositions are checked every minute and rebalanced if out of range.`,
        { reply_markup: backOnlyKeyboard() }
      );
    } catch (e) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
        { reply_markup: backOnlyKeyboard() }
      );
      setSession(ctx.from!.id, {});
    }
  });

  bot.callbackQuery("menu:check_positions", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.editMessageText("Create or import a wallet first.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    const positions = await getActivePositionsForUser(wallet._id);
    if (positions.length === 0) {
      await ctx.editMessageText("No active positions.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    const lines = positions.map((p) => {
      const feeEther = (Number(p.totalFeeEarnedWei) / 1e18).toFixed(6);
      return `${p.pair} #${p.tokenId} | Ticks: ${p.tickLower}-${p.tickUpper} | Fee earned: ${feeEther} MON`;
    });
    await ctx.editMessageText("Your positions:\n\n" + lines.join("\n"), {
      reply_markup: positionListKeyboard(positions.map((p) => ({ _id: p._id.toString(), pair: p.pair, tokenId: p.tokenId }))),
    });
  });

  bot.callbackQuery(/^position:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    const pos = await getPositionById(id as any);
    const feeEther = (Number(pos.totalFeeEarnedWei) / 1e18).toFixed(6);
    await ctx.editMessageText(
      `Position ${pos.pair}\nToken ID: ${pos.tokenId}\nTicks: ${pos.tickLower} - ${pos.tickUpper}\nInitial: ${pos.initialAmountWei} wei\nFee earned: ${feeEther} MON`,
      { reply_markup: backOnlyKeyboard() }
    );
  });

  bot.callbackQuery("menu:close_position", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.editMessageText("Create or import a wallet first.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    const positions = await getActivePositionsForUser(wallet._id);
    if (positions.length === 0) {
      await ctx.editMessageText("No active positions to close.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    await ctx.editMessageText("Select position to close (withdraws LP and stops rebalancing):", {
      reply_markup: closePositionSelectKeyboard(positions.map((p) => ({ _id: p._id.toString(), pair: p.pair, tokenId: p.tokenId }))),
    });
  });

  bot.callbackQuery(/^close:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const positionId = ctx.match[1];
    try {
      const pos = await getPositionById(positionId as any);
      const privateKey = await getPrivateKey(pos.walletId._id);
      const { burnPosition } = await import("../services/lpService.js");
      await burnPosition(privateKey, BigInt(pos.tokenId));
      await closePosition(pos._id);
      await ctx.editMessageText(
        `✅ Position closed. LP burned; funds sent to your wallet. Token ID was ${pos.tokenId}.`,
        { reply_markup: backOnlyKeyboard() }
      );
    } catch (e) {
      await ctx.editMessageText(`❌ Error: ${e instanceof Error ? e.message : String(e)}`, {
        reply_markup: backOnlyKeyboard(),
      });
    }
  });

  bot.callbackQuery("menu:export_keys", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.editMessageText("No wallet.", { reply_markup: backOnlyKeyboard() });
      return;
    }
    if (!wallet.isCustodial) {
      await ctx.editMessageText("Only custodial wallet keys can be exported. You imported this wallet.", {
        reply_markup: backOnlyKeyboard(),
      });
      return;
    }
    const pk = await getPrivateKey(wallet._id);
    await ctx.editMessageText(
      `⚠️ Your private key (keep secret):\n<code>${pk}</code>\n\nDo not share with anyone.`,
      { parse_mode: "HTML", reply_markup: backOnlyKeyboard() }
    );
  });

  bot.callbackQuery("menu:withdraw_funds", async (ctx) => {
    await ctx.answerCallbackQuery();
    setSession(ctx.from!.id, { step: "withdraw_address" });
    await ctx.editMessageText("Send the destination address (0x...):", { reply_markup: backOnlyKeyboard() });
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "withdraw_address";
  }, async (ctx) => {
    const addr = ctx.message.text.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      await ctx.reply("Invalid address. Send a 0x-prefixed 40-char hex address.");
      return;
    }
    setSession(ctx.from!.id, { ...getSession(ctx.from!.id)!, step: "withdraw_token", pendingWithdrawAddress: addr });
    await ctx.reply("Send token: MON or AUSD");
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "withdraw_token" && s?.pendingWithdrawAddress;
  }, async (ctx) => {
    const t = ctx.message.text.trim().toUpperCase();
    if (t !== "MON" && t !== "AUSD") {
      await ctx.reply("Send MON or AUSD");
      return;
    }
    setSession(ctx.from!.id, {
      ...getSession(ctx.from!.id)!,
      step: "withdraw_amount",
      pendingWithdrawToken: t as "MON" | "AUSD",
    });
    await ctx.reply(`Send amount of ${t} to withdraw (e.g. 0.1):`);
  });

  bot.on("message:text").filter((ctx) => {
    const s = getSession(ctx.from!.id);
    return s?.step === "withdraw_amount" && s?.pendingWithdrawToken;
  }, async (ctx) => {
    const amountStr = ctx.message.text.trim().replace(/,/g, ".");
    const num = parseFloat(amountStr);
    if (!Number.isFinite(num) || num <= 0) {
      await ctx.reply("Send a valid positive number.");
      return;
    }
    const session = getSession(ctx.from!.id)!;
    const userId = await getOrCreateUser(ctx.from!.id);
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      await ctx.reply("No wallet.");
      setSession(ctx.from!.id, {});
      return;
    }
    const privateKey = await getPrivateKey(wallet._id);
    const to = session.pendingWithdrawAddress! as `0x${string}`;
    const token = session.pendingWithdrawToken!;

    const progressMsg = await ctx.reply("Withdrawing...");
    try {
      const { getWalletClient } = await import("../services/blockchain.js");
      const walletClient = getWalletClient(privateKey);
      const account = (await import("viem/accounts")).privateKeyToAccount(privateKey);

      if (token === "MON") {
        const amountWei = parseEther(amountStr);
        const hash = await walletClient.sendTransaction({
          to,
          value: amountWei,
          account,
          chain: monadChain,
        });
        const publicClient = createPublicClient();
        await publicClient.waitForTransactionReceipt({ hash });
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, `✅ Sent ${amountStr} MON to ${to}`);
      } else {
        const { parseUnits } = await import("viem");
        const { AUSD_DECIMALS } = await import("../config.js");
        const amountWei = parseUnits(amountStr, AUSD_DECIMALS);
        const hash = await walletClient.writeContract({
          address: AUSD_ADDRESS as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [to, amountWei],
          account,
          chain: monadChain,
        });
        const publicClient = createPublicClient();
        await publicClient.waitForTransactionReceipt({ hash });
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, `✅ Sent ${amountStr} AUSD to ${to}`);
      }
      setSession(ctx.from!.id, {});
    } catch (e) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `❌ Error: ${e instanceof Error ? e.message : String(e)}`
      );
      setSession(ctx.from!.id, {});
    }
  });
}
