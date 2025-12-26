"use client";

import { useState } from "react";
import { Phone, Check, X, Loader2, Trash2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePhoneVerification } from "@/hooks/use-contact-sync";
import { cn } from "@/lib/utils";

export function PhoneVerification() {
  const {
    status,
    loading,
    sending,
    verifying,
    error,
    sendCode,
    verifyCode,
    removePhone,
  } = usePhoneVerification();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [step, setStep] = useState<"phone" | "verify">("phone");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSendCode = async () => {
    if (!phoneNumber) {
      setLocalError("Please enter a phone number");
      return;
    }
    setLocalError(null);
    try {
      await sendCode(phoneNumber);
      setStep("verify");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to send code");
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setLocalError("Please enter the 6-digit code");
      return;
    }
    setLocalError(null);
    try {
      await verifyCode(verificationCode);
      setStep("phone");
      setPhoneNumber("");
      setVerificationCode("");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to verify code");
    }
  };

  const handleRemovePhone = async () => {
    try {
      await removePhone();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to remove phone");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Phone is already verified
  if (status?.phone_verified) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-500/10">
                <Phone className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-base">Phone Number</CardTitle>
                <CardDescription>
                  Verified: ****{status.phone_last_4}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-green-500">
                <Check className="w-4 h-4" />
                Verified
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Phone Number</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove your phone number and clear all synced contacts.
                      You'll need to verify again to use contact discovery.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleRemovePhone}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your phone number is verified. You can now sync your contacts to discover
            friends on NoChat.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Phone not verified - show verification form
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Phone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Phone Verification</CardTitle>
            <CardDescription>
              Verify your phone to discover contacts on NoChat
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "phone" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className={cn(localError && "border-destructive")}
              />
              {localError && (
                <p className="text-xs text-destructive">{localError}</p>
              )}
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50">
              <Shield className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Your phone number is hashed for privacy. We never store or share your
                actual phone number with other users.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={handleSendCode}
              disabled={sending}
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Verification Code"
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Enter the 6-digit code sent to {phoneNumber}
              </p>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                className={cn("text-center text-2xl tracking-widest", localError && "border-destructive")}
              />
              {localError && (
                <p className="text-xs text-destructive">{localError}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStep("phone");
                  setVerificationCode("");
                  setLocalError(null);
                }}
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleVerifyCode}
                disabled={verifying || verificationCode.length !== 6}
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Verify
                  </>
                )}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleSendCode}
              disabled={sending}
            >
              Didn't receive the code? Send again
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
