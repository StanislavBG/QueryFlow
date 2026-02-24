import { useStripeProducts, useCreateCheckoutSession, usePaymentHistory } from "@/hooks/use-stripe";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = amount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "usd",
  }).format(value);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 border-emerald-600/30">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1 text-red-500 border-red-500/30">
        <XCircle className="w-2.5 h-2.5" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] gap-1 text-yellow-600 border-yellow-600/30">
      <Clock className="w-2.5 h-2.5" />
      Pending
    </Badge>
  );
}

export function PricingPage() {
  const { data: products, isLoading: productsLoading } = useStripeProducts();
  const { data: payments, isLoading: paymentsLoading } = usePaymentHistory();
  const checkoutMutation = useCreateCheckoutSession();
  const { toast } = useToast();

  // Check for success/canceled in URL params (redirect back from Stripe)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "success") {
      toast({ title: "Payment successful", description: "Thank you for your support!" });
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("stripe") === "canceled") {
      toast({ title: "Payment canceled", description: "No charge was made." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const handleCheckout = (priceId: string) => {
    checkoutMutation.mutate(
      { priceId },
      {
        onSuccess: (data) => {
          if (data.sessionUrl) {
            window.location.href = data.sessionUrl;
          }
        },
        onError: (err) => {
          toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <ScrollArea className="h-full">
      <div className="px-1 py-2 space-y-5">
        {/* Products section */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Support QueryFlow</h3>

          {productsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !products || products.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No products available at this time.
            </p>
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <div
                  key={product.priceId}
                  className="rounded-lg border border-border p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{product.name}</p>
                      {product.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap">
                      {formatCurrency(product.amount, product.currency)}
                      {product.interval && (
                        <span className="text-[10px] font-normal text-muted-foreground">
                          /{product.interval}
                        </span>
                      )}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => handleCheckout(product.priceId)}
                    disabled={checkoutMutation.isPending}
                  >
                    {checkoutMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <ExternalLink className="w-3 h-3 mr-1" />
                    )}
                    {product.interval ? "Subscribe" : "Purchase"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payment history section */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Payment History</h3>

          {paymentsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !payments || payments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No payments yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusBadge status={payment.status} />
                    <span className="text-xs text-muted-foreground truncate">
                      {new Date(payment.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="text-xs font-medium whitespace-nowrap">
                    {formatCurrency(payment.amount, payment.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
