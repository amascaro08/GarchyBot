import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-8">
          Join <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">Garchy Bot</span>
        </h1>
        <SignUp 
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-slate-800 shadow-2xl",
            }
          }}
        />
      </div>
    </div>
  );
}
