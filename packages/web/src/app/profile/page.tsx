"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Loader2, Save, User, Briefcase, MapPin, Link as LinkIcon, Heart, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks";
import { api } from "@/lib/api";

type RelationshipStatus =
  | "single"
  | "in_a_relationship"
  | "engaged"
  | "married"
  | "its_complicated"
  | "open_relationship"
  | "prefer_not_to_say"
  | "";

const RELATIONSHIP_STATUS_OPTIONS: { value: RelationshipStatus; label: string }[] = [
  { value: "", label: "Select..." },
  { value: "single", label: "Single" },
  { value: "in_a_relationship", label: "In a Relationship" },
  { value: "engaged", label: "Engaged" },
  { value: "married", label: "Married" },
  { value: "its_complicated", label: "It's Complicated" },
  { value: "open_relationship", label: "Open Relationship" },
  { value: "prefer_not_to_say", label: "Prefer Not to Say" },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, token, isAuthVerified, isLoading: isCheckingAuth } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Profile fields
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus>("");
  const [pronouns, setPronouns] = useState("");
  const [birthday, setBirthday] = useState("");

  // Original values to track changes
  const [originalValues, setOriginalValues] = useState<any>(null);

  // Redirect if not authenticated
  // Wait for auth check to complete AND confirm no user/token before redirecting
  useEffect(() => {
    // Only redirect if auth check is complete and we're definitely not authenticated
    // Check both isAuthVerified (API verified) and token (local state) to avoid race conditions
    if (!isCheckingAuth && !isAuthVerified && !token) {
      router.push("/signin");
    }
  }, [isCheckingAuth, isAuthVerified, token, router]);

  // Load profile data
  useEffect(() => {
    if (!isAuthVerified) return;

    const loadProfile = async () => {
      try {
        const profile = await api.getMyProfile();
        setDisplayName(profile.display_name || "");
        setAvatarUrl(profile.avatar_url || "");
        setBio(profile.bio || "");
        setJobTitle(profile.job_title || "");
        setCompany(profile.company || "");
        setLocation(profile.location || "");
        setWebsite(profile.website || "");
        setRelationshipStatus((profile.relationship_status as RelationshipStatus) || "");
        setPronouns(profile.pronouns || "");
        setBirthday(profile.birthday ? profile.birthday.split("T")[0] : "");

        setOriginalValues({
          display_name: profile.display_name || "",
          avatar_url: profile.avatar_url || "",
          bio: profile.bio || "",
          job_title: profile.job_title || "",
          company: profile.company || "",
          location: profile.location || "",
          website: profile.website || "",
          relationship_status: profile.relationship_status || "",
          pronouns: profile.pronouns || "",
          birthday: profile.birthday ? profile.birthday.split("T")[0] : "",
        });
      } catch (err: any) {
        setError(err.message || "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [isAuthVerified]);

  const hasChanges = () => {
    if (!originalValues) return false;
    return (
      displayName !== originalValues.display_name ||
      avatarUrl !== originalValues.avatar_url ||
      bio !== originalValues.bio ||
      jobTitle !== originalValues.job_title ||
      company !== originalValues.company ||
      location !== originalValues.location ||
      website !== originalValues.website ||
      relationshipStatus !== originalValues.relationship_status ||
      pronouns !== originalValues.pronouns ||
      birthday !== originalValues.birthday
    );
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const updates: any = {};

      if (displayName !== originalValues?.display_name) updates.display_name = displayName;
      if (avatarUrl !== originalValues?.avatar_url) updates.avatar_url = avatarUrl;
      if (bio !== originalValues?.bio) updates.bio = bio;
      if (jobTitle !== originalValues?.job_title) updates.job_title = jobTitle;
      if (company !== originalValues?.company) updates.company = company;
      if (location !== originalValues?.location) updates.location = location;
      if (website !== originalValues?.website) updates.website = website;
      if (relationshipStatus !== originalValues?.relationship_status) updates.relationship_status = relationshipStatus;
      if (pronouns !== originalValues?.pronouns) updates.pronouns = pronouns;
      if (birthday !== originalValues?.birthday) updates.birthday = birthday;

      const profile = await api.updateMyProfile(updates);

      // Update original values
      setOriginalValues({
        display_name: profile.display_name || "",
        avatar_url: profile.avatar_url || "",
        bio: profile.bio || "",
        job_title: profile.job_title || "",
        company: profile.company || "",
        location: profile.location || "",
        website: profile.website || "",
        relationship_status: profile.relationship_status || "",
        pronouns: profile.pronouns || "",
        birthday: profile.birthday ? profile.birthday.split("T")[0] : "",
      });

      setSuccess("Profile updated successfully!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be less than 5MB");
      return;
    }

    try {
      // Request upload URL from server
      const { upload_url, storage_key } = await api.requestUploadUrl({
        filename: file.name,
        content_type: file.type,
        size: file.size,
      });

      // Upload the file
      await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      // Construct the public URL (assumes S3/MinIO URL pattern)
      const publicUrl = upload_url.split("?")[0];
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      setError(err.message || "Failed to upload image");
    }
  };

  if (isCheckingAuth || loading) {
    return (
      <div className="min-h-screen min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-dvh py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="gap-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving || !hasChanges()}
            className="gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-500 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Avatar Section */}
        <Card className="glass border-border">
          <CardHeader>
            <CardTitle>Profile Photo</CardTitle>
            <CardDescription>
              Your profile photo is visible to your contacts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div
                className="relative w-24 h-24 rounded-full bg-secondary flex items-center justify-center cursor-pointer overflow-hidden group"
                onClick={handleAvatarClick}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-12 h-12 text-muted-foreground" />
                )}
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="space-y-2">
                <Button variant="outline" onClick={handleAvatarClick}>
                  Upload Photo
                </Button>
                {avatarUrl && (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setAvatarUrl("")}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card className="glass border-border">
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Tell others about yourself
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Display Name */}
            <div className="space-y-2">
              <label htmlFor="displayName" className="text-sm font-medium">
                Display Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How you want to be called"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-2">
              <label htmlFor="bio" className="text-sm font-medium">
                Bio
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself..."
                className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {bio.length}/500
              </p>
            </div>

            {/* Pronouns */}
            <div className="space-y-2">
              <label htmlFor="pronouns" className="text-sm font-medium">
                Pronouns
              </label>
              <Input
                id="pronouns"
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                placeholder="e.g., they/them, she/her, he/him"
              />
            </div>
          </CardContent>
        </Card>

        {/* Work */}
        <Card className="glass border-border">
          <CardHeader>
            <CardTitle>Work</CardTitle>
            <CardDescription>
              Share your professional information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Job Title */}
            <div className="space-y-2">
              <label htmlFor="jobTitle" className="text-sm font-medium">
                Job Title
              </label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="jobTitle"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g., Software Engineer"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-2">
              <label htmlFor="company" className="text-sm font-medium">
                Company
              </label>
              <Input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Where you work"
              />
            </div>
          </CardContent>
        </Card>

        {/* Personal */}
        <Card className="glass border-border">
          <CardHeader>
            <CardTitle>Personal</CardTitle>
            <CardDescription>
              Optional personal details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Location */}
            <div className="space-y-2">
              <label htmlFor="location" className="text-sm font-medium">
                Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., San Francisco, CA"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Website */}
            <div className="space-y-2">
              <label htmlFor="website" className="text-sm font-medium">
                Website
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Relationship Status */}
            <div className="space-y-2">
              <label htmlFor="relationshipStatus" className="text-sm font-medium">
                Relationship Status
              </label>
              <div className="relative">
                <Heart className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <select
                  id="relationshipStatus"
                  value={relationshipStatus}
                  onChange={(e) => setRelationshipStatus(e.target.value as RelationshipStatus)}
                  className="w-full h-10 pl-10 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {RELATIONSHIP_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Birthday */}
            <div className="space-y-2">
              <label htmlFor="birthday" className="text-sm font-medium">
                Birthday
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="birthday"
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
