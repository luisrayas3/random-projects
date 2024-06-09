use std::iter;


fn sln(x: f32) -> f32 { (x + 1.0).ln() }

#[derive(Debug)]
struct Land {
    p: f32,  // productivity
}

#[derive(Debug)]
struct Map {
    lands: Vec<Land>,
}

#[derive(Debug, Clone, Default)]
struct AgentState {
    lands: Vec<usize>,
    capital: f32,
}
#[derive(Debug, Clone, Default)]
struct Action {
    c: f32,  // capital saved, as a ratio
    t: f32,  // time spent laboring (0-1)
}
#[derive(Debug, Clone, Default)]
struct AgentNode {
    state: AgentState,
    action: Action,  // Pure policies
    // Intermediate 'states' (phases) from partial `action` application
    capital_plus: f32,
    utility_yielded: f32,
}

#[derive(Debug, Clone)]
struct GameNode <'g> {
    map: &'g Map,
    agents: Vec<AgentNode>,
}
impl <'g> GameNode <'g> {
    fn new(map: &'g Map, n: usize) -> Self {
        Self {
            map: map,
            agents: iter::repeat(Default::default()).take(n).collect(),
        }
    }
    fn from(other: Self) -> Self {
        return Self::new(other.map, other.agents.len());
    }
}

const K_TIME_PRODUCTIVITY: f32 = 1.0;
const K_TIME_ENJOYMENT: f32 = 1.0;
const K_CAPITAL_PRODUCTIVITY: f32 = 1.0;
const K_CAPITAL_ENJOYMENT: f32 = 1.0;
const K_CAPITAL_DEPRECIATION: f32 = 0.9;
const K_TIME_PREFERENCE: f32 = 0.9;

const K_POLICY_DIFF_EPSILON: f32 = 0.00001;  // Actually diff^2

/// $$
/// p * \ln(k_tp * t_p + 1) * (1 + \ln(k_cp * c_e * C + 1))
/// $$
fn produce(land_productivity: f32, time: f32, capital: f32) -> f32 {
    // Returns produced capital
    land_productivity
    * sln(K_TIME_PRODUCTIVITY * time)
    * (1.0 + sln(K_CAPITAL_PRODUCTIVITY * capital))
}
/// $$
/// \ln(k_te * t_e + 1) * (1 + \ln(k_ce * c_e * C + 1))
/// $$
fn consume(time: f32, capital: f32) -> f32 {
    // Returns generated utility
    sln(K_TIME_ENJOYMENT * time)
    * (1.0 + sln(K_CAPITAL_ENJOYMENT * capital))
}

fn find_best_land(map: &Map, agent_state: &AgentState) -> f32 {
    agent_state.lands.iter()
        .map(|i| map.lands[*i].p)
        .max_by(|a, b| a.partial_cmp(b).unwrap())
        .unwrap()
}

fn calculate_dV_dC(node: &GameNode, next_dV_dCs: &Vec<f32>) -> Vec<f32> {
    let mut dV_dC: Vec<f32> = vec![];
    for (agent, next_dV_dC) in iter::zip(&node.agents, next_dV_dCs) {
        let p = find_best_land(&node.map, &agent.state);
        // Cplus = C + p * \ln(k_tp * t_p + 1) * (1 + \ln(k_cp * C + 1))
        // \pdv{Cplus}{C} =
        //     1 + p * \ln(k_tp * t_p + 1) * \frac{k_cp}{k_cp * C + 1}
        let dCplus_dC =
            1.0
            + p
             * sln(K_TIME_PRODUCTIVITY * agent.action.t)
             / (K_CAPITAL_PRODUCTIVITY * agent.state.capital + 1.0)
        ;
        // U = \ln(k_te * t_e + 1) * (1 + \ln(k_ce * c_e * Cplus + 1))
        // \pdv{U}{Cplus} =
        //     \ln(k_te * t_e + 1) * \frac{k_ce * c_e}{k_ce * c_e * Cplus + 1}
        let c_e = 1.0 - agent.action.c;
        let dU_dC =
            sln(K_TIME_ENJOYMENT * (1.0 - agent.action.t))
            * K_CAPITAL_ENJOYMENT * c_e
            / (K_CAPITAL_ENJOYMENT * c_e * agent.capital_plus + 1.0)
            * dCplus_dC
        ;
        let dCprime_dC = K_CAPITAL_DEPRECIATION * agent.action.c * dCplus_dC;
        dV_dC.push(dU_dC + K_TIME_PREFERENCE * next_dV_dC * dCprime_dC);
    }
    return dV_dC;
}

/// Re-evaluates a state assuming a new policy
fn step_node(node: &mut GameNode, results: Vec<&mut AgentState>) {
    for (agent, result) in iter::zip(&mut node.agents, results) {
        // TODO: Implement trading lands
        result.lands = agent.state.lands.clone();
        let best_land = find_best_land(&node.map, &agent.state);
        agent.capital_plus =
            agent.state.capital
            + produce(best_land, agent.action.t, agent.action.c * agent.state.capital)
        ;
        agent.utility_yielded =
            consume(1.0 - agent.action.t, (1.0 - agent.action.c) * agent.capital_plus)
        ;
        result.capital = agent.action.c * agent.capital_plus * K_CAPITAL_DEPRECIATION;
    }
}

/// Update node's policy given the next state's dV/dC's
fn update_policy(node: &mut GameNode, dV_dCs: &Vec<f32>) -> Vec<f32> {
    let mut diffs: Vec<f32> = Vec::new();
    for (agent, _dV_dC) in node.agents.iter_mut().zip(dV_dCs) {
        let prev_action = agent.action.clone();
        // \pdv{V}{t} = 0 =
        //     \pdv{U}{t} + k_tp * \pdv{Vprime}{Cprime} * \pdv{Cprime}{t}
        // U = \ln(k_te * t + 1) * (1 + \ln(k_ce * C + 1))
        // \pdv{U}{t} =
        //     \frac{k_te}{k_te * t + 1} * (1 + \ln(c_ce))
        agent.action.t = 0.0;  // TODO
        agent.action.c = 0.0;  // TODO
        diffs.push(
            (agent.action.t - prev_action.c).powf(2.0)
            + (agent.action.c - prev_action.c).powf(2.0)
        );
    }
    return diffs;
}

/// Returns dV_dC for the root state.
fn solve(game_sequence: &mut [GameNode]) -> Vec<f32> {
    let game_length = game_sequence.len();
    assert!(game_length >= 1);
    let (head, tail) = game_sequence.split_at_mut(1);
    let root = &mut head[0];
    if game_length <= 1 {
        // If this is the end of the game,
        // there is 0 additional value in saving capital.
        return calculate_dV_dC(root, &vec![0.0; root.agents.len()]);
    }
    loop {
        step_node(root, tail[0].agents.iter_mut().map(|a| &mut a.state).collect());
        let next_dV_dCs = solve(&mut tail[..]);
        let policy_diff = update_policy(root, &next_dV_dCs);
        if policy_diff.iter().all(|d| *d < K_POLICY_DIFF_EPSILON) {
            return calculate_dV_dC(root, &next_dV_dCs);
        }
    }
}

fn main() {
    let map = Map {
        lands: vec![
            Land { p: 2.0, },
            Land { p: 2.0, },
            Land { p: 1.0, },
        ],
    };
    let mut init_node = GameNode::new(&map, 2);
    init_node.agents[0].state.lands.push(0);
    init_node.agents[1].state.lands.push(1);

    let mut game_sequence = vec![init_node];

    let depth_goal: usize = 5;
    let mut dV_dC: Vec<f32> = vec![];
    while game_sequence.len() < depth_goal {
        game_sequence.push(game_sequence.last().unwrap().clone());
        dV_dC = solve(&mut game_sequence[..]);
    }
    // TODO: Final forward-only pass

    println!("Sensitivity to initial capital:");
    println!("  {:?}", dV_dC);
    for (i, node) in game_sequence.iter().enumerate() {
        println!("{i}:");
        println!("  {:?}", node);
    }
}
