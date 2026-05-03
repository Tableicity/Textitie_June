import { useListTiers } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Box } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Tiers() {
  const { data: tiers, isLoading } = useListTiers();

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading tiers...</div>;
  }

  // Sort tiers by logical order
  const order = { starter: 1, growth: 2, enterprise: 3 };
  const sortedTiers = tiers ? [...tiers].sort((a, b) => order[a.code] - order[b.code]) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Service Tiers</h1>
        <p className="text-muted-foreground mt-2">Platform pricing and feature caps.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {sortedTiers.map((tier) => {
          const isEnterprise = tier.code === "enterprise";
          return (
            <Card key={tier.id} className={cn("relative flex flex-col", isEnterprise && "border-primary ring-1 ring-primary shadow-lg")}>
              {isEnterprise && (
                <div className="absolute top-0 right-0 -mt-3 mr-4">
                  <Badge className="bg-primary text-primary-foreground font-semibold px-3 py-1">
                    SOVEREIGN
                  </Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Box className={cn("h-5 w-5", isEnterprise ? "text-primary" : "text-muted-foreground")} />
                  <CardTitle className="capitalize text-xl">{tier.name}</CardTitle>
                </div>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ul className="space-y-3 text-sm flex-1">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className={cn("h-4 w-4 shrink-0 mt-0.5", isEnterprise ? "text-primary" : "text-emerald-500")} />
                      <span className="text-foreground/80">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
