import { Plus, Database } from "lucide-react";

export const QuickConnection = ({ savedConnections, onConnect }: any) => {
  return (
    <div className="flex-1 bg-[#1e1e1e] p-8 overflow-y-auto">
       <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-[#cccccc]">
             <Database size={20} className="text-[#007acc]" />
             Your Connections
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
             {savedConnections.map((conn: any) => (
                <div 
                   key={conn.id}
                   onDoubleClick={() => onConnect(conn.id)}
                   className="aspect-video bg-[#252526] border border-[#3C3C3C] rounded-md p-4 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-[#2C2C2C] hover:border-[#007acc]/50 transition-all group"
                >
                   <div className={`p-3 rounded-full bg-opacity-10 bg-${conn.color}-500 text-${conn.color}-500 group-hover:scale-110 transition-transform`}>
                      <Database size={24} className={conn.type === 'Postgres' ? 'text-[#336791]' : conn.type === 'MySql' ? 'text-[#E68E00]' : 'text-[#003B57]'} />
                   </div>
                   <div className="text-center">
                      <h3 className="font-medium text-sm text-[#cccccc] group-hover:text-white">{conn.name}</h3>
                      <p className="text-xs text-[#999999]">{conn.type}</p>
                   </div>
                </div>
             ))}

             <button 
                className="aspect-video border border-dashed border-[#3C3C3C] rounded-md flex flex-col items-center justify-center gap-2 text-[#999999] hover:text-white hover:border-[#cccccc] hover:bg-[#252526] transition-all"
             >
                <Plus size={24} />
                <span className="text-xs font-medium">New Connection</span>
             </button>
          </div>
       </div>
    </div>
  );
};
