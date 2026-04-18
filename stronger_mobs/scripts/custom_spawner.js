import { world, system } from "@minecraft/server";


// Configuration
const MIN_SPAWN_RADIUS = 12;
const MAX_SPAWN_RADIUS = 50;
const Max_mobs_sphere = 50;
const LIGHT_LEVEL_MAX = 5;
const Y_levels_checks = 10;
const SPAWN_ATTEMPTS_PER_SPHERE = 30;
const SPAWN_INTERVAL = 100;
const LOGGING_ENABLED = true; 
const MOB_TYPES = {
    overworld: ["minecraft:zombie", "minecraft:skeleton", "minecraft:spider",
        "minecraft:zombie", "minecraft:skeleton", "minecraft:spider",
        "minecraft:zombie", "minecraft:skeleton", "minecraft:spider",
        "minecraft:witch","minecraft:witch",
        "minecraft:creeper", "minecraft:enderman"],
    nether: [],
    end: ["minecraft:enderman"]
};

const NON_SPAWNABLE_PATTERNS = ["stairs","slab","carpet","pressure_plate", "button", "trapdoor", 
    "fence", "wall","chain","lantern","torch","rail","vine","ladder","sign","banner","bed","cake","candle","scaffolding"];


function logTime() {
    dbgAdd('TIME', `Time: ${world.getTimeOfDay()}}`);
}

function dbgAdd(type, message) {
    if (LOGGING_ENABLED) {
        console.log(`[${type}] ${message}`);
    }
}

function calcSpheresAllPlayers(players) {
    const playerLocations = players.map(p => ({
        location: p.location,
        name: p.name,
        world_dimension: getPlayerDimension(p)
    }));
    
    const playerSpheres = playerLocations.map(pl => ({
        playerId: pl.name, 
        center: pl.location,
        world_dimension: pl.world_dimension,
        radius: MIN_SPAWN_RADIUS
    }));

    // check neighbour spheres collide
    const neighbours = new Map();
    for (let i = 0; i < playerSpheres.length; i++) {
        const sphereA = playerSpheres[i];
        for (let j = i + 1; j < playerSpheres.length; j++) {
            const sphereB = playerSpheres[j];
            
            if (sphereA.world_dimension !== sphereB.world_dimension) continue;
            
            const distance = Math.sqrt(
                Math.pow(sphereA.center.x - sphereB.center.x, 2) +
                Math.pow(sphereA.center.y - sphereB.center.y, 2) +
                Math.pow(sphereA.center.z - sphereB.center.z, 2)
            );
            
            if (distance < sphereA.radius + sphereB.radius) {
                if (!neighbours.has(sphereA.playerId)) neighbours.set(sphereA.playerId, new Set());
                if (!neighbours.has(sphereB.playerId)) neighbours.set(sphereB.playerId, new Set());
                
                neighbours.get(sphereA.playerId).add(sphereB.playerId);
                neighbours.get(sphereB.playerId).add(sphereA.playerId);
            }
        }
    }

    trySpawnMob(playerSpheres, neighbours);
}

function getPlayerDimension(player) {
    try {
        //try dim from player object
        if (player.dimension) {
            return player.dimension;
        }
        
        //fallback2
        const playerName = player.name;
        const allPlayers = world.getPlayers();
        const freshPlayer = allPlayers.find(p => p.name === playerName);
        
        if (freshPlayer && freshPlayer.dimension) {
            return freshPlayer.dimension;
        }
        
        //fallback3
        console.warn("Could not determine dimension for player:", player.name);
        return world.getDimension("overworld");
        
    } catch (error) {
        console.error("Error getting player dimension:", error);
        return world.getDimension("overworld");
    }
}

function trySpawnMob(playerSpheres, neighbours) {
    for (const sphere of playerSpheres) {
        const sphereNeighbours = neighbours.get(sphere.playerId) || new Set();
        
        const dimension = sphere.world_dimension;
        let nearbyMobs = 0;
        const queryOptions = {
            location: sphere.center,
            maxDistance: MAX_SPAWN_RADIUS,
        };
        nearbyMobs += dimension.getEntities(queryOptions).length;

        dbgAdd('Stronger_Mobs', "mobs counted: " + nearbyMobs );
        if(nearbyMobs < Max_mobs_sphere){

             for (let i = 0; i < SPAWN_ATTEMPTS_PER_SPHERE; i++) {
                const randomLocation = getRandomPointInSphericalShell(
                    sphere.center, 
                    MIN_SPAWN_RADIUS, 
                    MAX_SPAWN_RADIUS
                );
                
                // Check if point is within any neighbor's min sphere
                let validLocation = true;
                for (const neighbourId of sphereNeighbours) {
                    const neighbourSphere = playerSpheres.find(s => s.playerId === neighbourId);
                    if (isPointInSphere(randomLocation, neighbourSphere.center, MIN_SPAWN_RADIUS)) {
                        dbgAdd('Stronger_Mobs', "spawnblock in neighbour_circle" + i);
                        validLocation = false;
                    }
                    if( !dimension.isChunkLoaded(randomLocation)){
                        dbgAdd('Stronger_Mobs', "chunk not loaded" + i);
                        validLocation = false;
                    }
                }
                
                if (validLocation){
                    const spawnBlock_location = check_can_spawn_mob_on_block(randomLocation, dimension);
                    if (spawnBlock_location) {
                        spawn_mob_on_block(spawnBlock_location.loc, dimension);
                        if(spawnBlock_location.topbl) i +=3;
                    }
                }
            }
        }
        
    }
}

function getRandomPointInSphericalShell(center, minRadius, maxRadius) {
    let x, y, z, distance;
    do {
        x = center.x + (Math.random() * 2 - 1) * maxRadius;
        y = center.y + (Math.random() * 2 - 1) * maxRadius;
        z = center.z + (Math.random() * 2 - 1) * maxRadius;
        
        distance = Math.sqrt(
            Math.pow(x - center.x, 2) +
            Math.pow(y - center.y, 2) +
            Math.pow(z - center.z, 2)
        );
    } while (distance < minRadius || distance > maxRadius);
    
    return {x, y, z};
}

function isPointInSphere(point, sphereCenter, sphereRadius) {
    const distance = Math.sqrt(
        Math.pow(point.x - sphereCenter.x, 2) +
        Math.pow(point.y - sphereCenter.y, 2) +
        Math.pow(point.z - sphereCenter.z, 2)
    );
    return distance <= sphereRadius;
}


function spawnable_block_type(block){
    const blockId = block.typeId;
    for (const pattern of NON_SPAWNABLE_PATTERNS) {
        if (blockId.includes(pattern)) {
            dbgAdd("blockid spawn",blockId)
            return false;
        }
    }
    return true;
}


function check_can_spawn_mob_on_block(location, dimension) {
    let checkY = location.y + Y_levels_checks/2;
    let solidBlockLocation = { ...location };
    let block = null;
    solidBlockLocation.y = checkY;
    block = dimension.getBlockBelow(solidBlockLocation);
    if (!block || block.isAir || !spawnable_block_type(block)) {
        //dbgAdd('Stronger_Mobs', `Solid block found: ${block.typeId} at Y:${checkY}`);
        return null; 
    }

    if (!block){
        //dbgAdd('Stronger_Mobs', "no solid block found on y!" + solidBlockLocation.y + dimension.id);
        return null; 
    } 

    // Check for two air blocks above the solid block.
    const air1Loc = { x: block.x, y: block.y + 1, z: block.z };
    const air2Loc = { x: block.x, y: block.y + 2, z: block.z };

    const blockAbove1 = dimension.getBlock(air1Loc);
    const blockAbove2 = dimension.getBlock(air2Loc);

    if (!blockAbove1.isAir || !blockAbove2.isAir) {
         //dbgAdd('Stronger_Mobs', "no 2 air blocks!");
        return null;
    }

    const top_block = dimension.getTopmostBlock({ x: block.x, z: block.z });
    let lightLevel = 0;
    let topbl = false
    if (block.y == top_block.y){
        //dbgAdd('Stronger_Mobs', "block is topblock on y-cord"); 
        lightLevel = Math.max(blockAbove1.getSkyLightLevel(), blockAbove1.getLightLevel());
        topbl = true;
    }else{
        lightLevel = blockAbove1.getLightLevel();
    }
    
    if (lightLevel > LIGHT_LEVEL_MAX) {
        //dbgAdd('Stronger_Mobs', "lihgtlevel of block > 7");
        return null;
    }
    //dbgAdd('Stronger_Mobs', "lihgtlevel of block =" + lightLevel);
    return {loc: air1Loc, istopbl: topbl};
}


function spawn_mob_on_block(blockLocation, dimensionId) {
    // Get the dimension object from its ID.
    let dimension;
    switch (dimensionId) {
        case "nether":
            dimension = world.getDimension("minecraft:nether");
            break;
        case "the_end":
            dimension = world.getDimension("minecraft:the_end");
            break;
        default:
            dimension = world.getDimension("minecraft:overworld");
    }

    let mobList = MOB_TYPES.overworld; // default
    if (dimensionId === "nether") mobList = MOB_TYPES.nether;
    if (dimensionId === "the_end") mobList = MOB_TYPES.end;

    const randomMobType = mobList[Math.floor(Math.random() * mobList.length)];

    try {
        const entity = dimension.spawnEntity(randomMobType, blockLocation);
        //dbgAdd('Stronger_Mobs', "Spawned " + randomMobType + " at " + JSON.stringify(blockLocation));
    } catch (error) {
        //dbgAdd('Stronger_Mobs', "Failed to spawn mob: " + error);
    }
}


system.runInterval(() => {
                
    logTime();

    const players = world.getPlayers();
    calcSpheresAllPlayers(players)
        
}, SPAWN_INTERVAL);

dbgAdd('Stronger_Mobs', `Mob Spawner STARTED - :p`);
