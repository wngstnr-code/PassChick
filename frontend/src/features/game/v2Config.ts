import { isGameV2TicketModeEnabled } from "./v2Domain";

export const GAME_V2_TICKET_MODE = isGameV2TicketModeEnabled(
  process.env.NEXT_PUBLIC_GAME_V2_TICKET_MODE,
);
