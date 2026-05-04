import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-50 text-center px-4">
      <div className="w-20 h-20 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mb-6">
        <SettingsIcon className="w-8 h-8 text-slate-300" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Settings</h2>
      <p className="text-slate-500 max-w-sm mb-8 text-sm">
        Configuration options for your tenant workspace are currently unavailable during this phased launch period.
      </p>
      <div className="inline-flex items-center justify-center px-4 py-2 bg-slate-100 text-slate-500 rounded-lg text-sm font-medium border border-slate-200">
        Coming Soon
      </div>
    </div>
  );
}