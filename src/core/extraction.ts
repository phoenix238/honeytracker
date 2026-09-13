/** The shape both /api/receipts/scan (a photo) and /api/extract (an email) return. */
export interface ExtractedExpense {
  isExpense: boolean;
  merchant: string;
  amountPence: number;
  date: string;
  category: string;
}
