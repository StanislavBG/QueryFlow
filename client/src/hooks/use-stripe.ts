import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface StripeProduct {
  productId: string;
  priceId: string;
  name: string;
  description: string | null;
  amount: number | null;
  currency: string;
  interval: string | null;
}

export interface PaymentRecord {
  id: number;
  userId: string;
  stripeSessionId: string;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  productId: string | null;
  priceId: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function useStripeProducts() {
  return useQuery<StripeProduct[]>({
    queryKey: ["stripe-products"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      return data.products;
    },
    retry: false,
  });
}

export function useCreateCheckoutSession() {
  return useMutation<{ sessionUrl: string }, Error, { priceId: string }>({
    mutationFn: async ({ priceId }) => {
      const res = await apiRequest("POST", "/api/stripe/create-checkout-session", { priceId });
      return res.json();
    },
  });
}

export function usePaymentHistory() {
  return useQuery<PaymentRecord[]>({
    queryKey: ["stripe-payments"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/payments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      const data = await res.json();
      return data.payments;
    },
    retry: false,
  });
}
