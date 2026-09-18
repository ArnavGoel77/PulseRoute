import React from 'react';
import DigitalTwinNode from '../../components/digital-twin/digital-twin-node';

export default function TmcCommandDashboard() {
  return (
    <div className="bg-[#0b0b0b] border border-[#2a2a2a] border-solid content-stretch flex items-start relative w-screen h-screen">
      {/* City Grid / Live View Placeholder */}
      <div className="bg-[#101010] border border-[#2a2a2a] border-solid flex-[1_0_0] h-full min-w-px overflow-clip relative">
        <div className="absolute bg-[#242424] h-[760px] left-[81px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[209px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[337px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[465px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[593px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[721px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[849px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[760px] left-[977px] top-[75px] w-[20px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[129px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[245px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[361px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[477px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[593px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[709px] w-[990px]" />
        <div className="absolute bg-[#242424] h-[20px] left-[33px] top-[825px] w-[990px]" />
        
        {/* Some City Blocks */}
        <div className="absolute bg-[#181818] border border-[#2a2a2a] border-solid h-[84px] left-[117px] top-[25px] w-[92px]" />
        <div className="absolute bg-[#181818] border border-[#2a2a2a] border-solid h-[84px] left-[117px] top-[141px] w-[92px]" />
        <div className="absolute bg-[#181818] border border-[#2a2a2a] border-solid h-[84px] left-[117px] top-[257px] w-[92px]" />
        <div className="absolute bg-[#181818] border border-[#2a2a2a] border-solid h-[84px] left-[245px] top-[25px] w-[92px]" />
        
        <p className="absolute font-semibold leading-[14px] left-[23px] text-[11px] text-[#8b8b8b] top-[21px] tracking-[1.32px] whitespace-nowrap">
          CITY GRID / LIVE DIGITAL TWIN
        </p>
        <p className="absolute font-normal leading-[16px] left-[23px] text-[12px] text-[#f5f5f5] top-[43px] whitespace-pre">
          {`42 INTERSECTIONS  ·  11 ACTIVE SIGNALS  ·  02 INCIDENTS`}
        </p>
        
        <DigitalTwinNode className="absolute bg-[#2b8a3e] left-[91px] size-[4px] top-[139px]" />
        <DigitalTwinNode className="absolute bg-[#c92a2a] left-[219px] size-[4px] top-[255px]" />
        <DigitalTwinNode className="absolute bg-[#2b8a3e] left-[347px] size-[4px] top-[371px]" />
        <DigitalTwinNode className="absolute bg-[#c92a2a] left-[475px] size-[4px] top-[487px]" />
        <DigitalTwinNode className="absolute bg-[#2b8a3e] left-[603px] size-[4px] top-[603px]" />
        <DigitalTwinNode className="absolute bg-[#2b8a3e] left-[731px] size-[4px] top-[719px]" />
        
        <p className="absolute font-semibold leading-[14px] left-[23px] text-[11px] text-[#8b8b8b] top-[857px] tracking-[1.32px] whitespace-pre">
          {`GRID RESOLUTION  250 m`}
        </p>
      </div>

      {/* Chaos Control Panel */}
      <div className="bg-[#141414] border-l border-[#2a2a2a] border-solid flex flex-col gap-[20px] h-full items-start overflow-y-auto px-[20px] py-[24px] relative shrink-0 w-[360px]">
        {/* Header */}
        <div className="flex flex-col gap-[10px] items-start shrink-0 w-full">
          <p className="font-semibold leading-[22px] text-[18px] text-[#f5f5f5] whitespace-nowrap">
            CHAOS CONTROL
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
            {`TMC-07  /  UTC  14:22:08`}
          </p>
        </div>

        {/* Active Missions */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            ACTIVE MISSIONS
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />
          
          <div className="border border-[#2a2a2a] border-solid flex flex-col gap-[4px] items-start px-[10px] py-[8px] w-full">
            <div className="flex items-start justify-between w-full">
              <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
                M-017
              </p>
              <div className="bg-[#272727] flex items-center justify-center px-[7px] py-[2px] rounded-[999px]">
                <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
                  EN ROUTE
                </p>
              </div>
            </div>
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
              {`MED 14  ·  8TH / MARKET`}
            </p>
          </div>

          <div className="border border-[#2a2a2a] border-solid flex flex-col gap-[4px] items-start px-[10px] py-[8px] w-full">
            <div className="flex items-start justify-between w-full">
              <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
                M-024
              </p>
              <div className="bg-[#272727] flex items-center justify-center px-[7px] py-[2px] rounded-[999px]">
                <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
                  REROUTING
                </p>
              </div>
            </div>
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
              {`FIRE 6  ·  RIVER / 3RD`}
            </p>
          </div>

          <div className="border border-[#2a2a2a] border-solid flex flex-col gap-[4px] items-start px-[10px] py-[8px] w-full">
            <div className="flex items-start justify-between w-full">
              <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
                M-031
              </p>
              <div className="bg-[#272727] flex items-center justify-center px-[7px] py-[2px] rounded-[999px]">
                <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
                  HOLD
                </p>
              </div>
            </div>
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
              {`UNIT 22  ·  HARBOR / OAK`}
            </p>
          </div>
        </div>

        {/* Live Event Feed */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            LIVE EVENT FEED
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-pre">
            {`14:21:44  SIG-204 → GREEN`}
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-pre">
            {`14:21:42  VEHICLE 22 GPS LOCK`}
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-pre">
            {`14:21:37  ROUTE CONFLICT RESOLVED`}
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
            {`14:21:30  NODE 8-14 DEGRADED`}
          </p>
        </div>

        {/* Simulation Controls */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            SIMULATION CONTROLS
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-nowrap">
            Inject a network incident into the live model.
          </p>
          <button className="bg-[#272727] hover:bg-[#333] transition-colors border border-[#2a2a2a] border-solid flex h-[44px] items-center justify-between px-[14px] shadow-[0px_4px_8px_0px_rgba(0,0,0,0.35)] w-full whitespace-nowrap cursor-pointer">
            <p className="font-semibold leading-[14px] text-[11px] text-[#f5f5f5] tracking-[1.32px]">
              DROP ROADBLOCK
            </p>
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b]">
              [ + ]
            </p>
          </button>
        </div>

        <div className="flex-grow" />

        {/* Panel Footer */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <div className="bg-[#2a2a2a] h-px w-full" />
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            SYSTEM STATUS
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
            SYNCED / 12 ms / NO DROPPED FRAMES
          </p>
        </div>
      </div>
    </div>
  );
}
